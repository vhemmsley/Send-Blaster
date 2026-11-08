const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https')
const { onTaskDispatched } = require('firebase-functions/v2/tasks')
const { Resend } = require('resend')
const admin = require('firebase-admin')
const crypto = require('crypto')

// =========================
// ENTERPRISE CONFIGURATION
// =========================

const DOMAIN_CONFIG = {
  'remittixlive.com': {
    apiKeyEnv: 'RESEND_KEY_REMITTIXLIVE',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'coretechk.com': {
    apiKeyEnv: 'RESEND_KEY_CORETECHK',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'brickbybric.com': {
    apiKeyEnv: 'RESEND_KEY_BRICKBYBRIC',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'lgihtchain.com': {
    apiKeyEnv: 'RESEND_KEY_LGIHTCHAIN',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
}

const CONFIG = {
  BATCH_SIZE: 27,
  EMAIL_INTERVAL_MS: 500,
  MAX_RETRIES: 2,
  RETRY_DELAY_MINUTES: 5,
  HOURLY_TARGET: 3240,
  ORPHAN_THRESHOLD_MINUTES: 10,
  STUCK_DISTRIBUTED_THRESHOLD_MS: 10 * 60 * 1000,
  LOCK_TIMEOUT_MINUTES: 15,
}

admin.initializeApp()
const db = admin.firestore()

// =========================
// API KEY MANAGEMENT (from env vars)
// =========================

// Cache for API keys so we don't re-read env vars repeatedly
const apiKeyCache = {}

function getApiKey(domain) {
  const config = DOMAIN_CONFIG[domain]
  if (!config) {
    throw new Error(`No domain config for: ${domain}`)
  }

  if (apiKeyCache[domain]) {
    return apiKeyCache[domain]
  }

  const apiKey = process.env[config.apiKeyEnv]
  if (!apiKey) {
    throw new Error(`Missing env var: ${config.apiKeyEnv} for domain ${domain}`)
  }

  apiKeyCache[domain] = apiKey
  return apiKey
}

function getResendClient(domain) {
  const apiKey = getApiKey(domain)
  return new Resend(apiKey)
}

// =========================
// CLOUD TASKS HELPER (using Firebase v2 task queues)
// =========================

const { getFunctions } = require('firebase-admin/functions')

async function enqueueTask(queueName, payload = {}, options = {}) {
  try {
    const queue = getFunctions().taskQueue(queueName)

    const enqueueOptions = {}
    if (options.scheduleDelaySeconds && options.scheduleDelaySeconds > 0) {
      enqueueOptions.scheduleDelaySeconds = options.scheduleDelaySeconds
    }

    await queue.enqueue(payload, enqueueOptions)
    console.log(`📋 Enqueued task to ${queueName}`)
    return { success: true }
  } catch (err) {
    console.error(`❌ Failed to enqueue task to ${queueName}:`, err.message)
    return { success: false, error: err.message }
  }
}

// =========================
// UTILITY FUNCTIONS
// =========================

function generateCampaignId(domain) {
  return `cmp_${domain}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeEmail(email) {
  return email.trim().toLowerCase()
}

function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

// Rolling 30-day usage is enforced by Firestore transactions, never by the UI.
const USAGE_LIMIT = 100000
const USAGE_SETTINGS_REF = () => db.collection('systemSettings').doc('emailUsage')

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function getUnsubscribeUrl(token) {
  const base = process.env.UNSUBSCRIBE_BASE_URL
  if (!base)
    throw new Error('Missing UNSUBSCRIBE_BASE_URL (public HTTPS URL of the unsubscribe function)')
  return `${base.replace(/\/$/, '')}?token=${encodeURIComponent(token)}`
}

function appendUnsubscribeFooter(html, token) {
  const url = getUnsubscribeUrl(token)
  const footer = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;text-align:center;">If you no longer wish to receive these emails, <a href="${url}" style="color:#6b7280;text-decoration:underline;">unsubscribe here</a>.</div>`
  return `${html}\n${footer}`
}

async function reserveUsageSlot(queueId) {
  return db.runTransaction(async (tx) => {
    const reservationRef = db.collection('usageReservations').doc(queueId)
    const reservationSnap = await tx.get(reservationRef)
    if (reservationSnap.exists && reservationSnap.data().status === 'reserved')
      return reservationSnap.data().cycleId
    if (reservationSnap.exists && reservationSnap.data().status === 'accepted') {
      throw new Error('This recipient already has a provider-accepted send recorded.')
    }
    const settingsRef = USAGE_SETTINGS_REF()
    const settingsSnap = await tx.get(settingsRef)
    const cycleId = settingsSnap.exists ? settingsSnap.data().activeCycleId : null
    if (!cycleId)
      throw new Error('No active 30-day sending cycle. Activate a cycle before sending.')
    const cycleRef = db.collection('usageCycles').doc(cycleId)
    const cycleSnap = await tx.get(cycleRef)
    if (!cycleSnap.exists) throw new Error('Active usage cycle record is missing.')
    const cycle = cycleSnap.data()
    const endMs = cycle.cycleEndsAt?.toMillis
      ? cycle.cycleEndsAt.toMillis()
      : new Date(cycle.cycleEndsAt).getTime()
    if (cycle.status !== 'active' || !Number.isFinite(endMs) || Date.now() >= endMs) {
      throw new Error('The 30-day sending cycle has expired. Activate a new cycle to continue.')
    }
    const accepted = Number(cycle.acceptedCount || 0)
    const reserved = Number(cycle.reservedCount || 0)
    if (accepted + reserved >= USAGE_LIMIT)
      throw new Error('The 100,000-email cycle allowance has been reached.')
    tx.update(cycleRef, {
      reservedCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    tx.set(reservationRef, {
      queueId,
      cycleId,
      status: 'reserved',
      reservedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return cycleId
  })
}

async function releaseUsageReservation(cycleId, queueId) {
  if (!cycleId || !queueId) return
  await db.runTransaction(async (tx) => {
    const reservationRef = db.collection('usageReservations').doc(queueId)
    const reservationSnap = await tx.get(reservationRef)
    if (
      !reservationSnap.exists ||
      reservationSnap.data().status !== 'reserved' ||
      reservationSnap.data().cycleId !== cycleId
    )
      return
    const cycleRef = db.collection('usageCycles').doc(cycleId)
    const cycleSnap = await tx.get(cycleRef)
    if (cycleSnap.exists && Number(cycleSnap.data().reservedCount || 0) > 0) {
      tx.update(cycleRef, {
        reservedCount: admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    tx.update(reservationRef, {
      status: 'released',
      releasedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })
}

function verifyResendWebhook(req) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET is not configured')
  const id = req.get('svix-id')
  const timestamp = req.get('svix-timestamp')
  const signature = req.get('svix-signature')
  if (!id || !timestamp || !signature || !req.rawBody) return false
  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300)
    return false
  const signedContent = `${id}.${timestamp}.${req.rawBody.toString('utf8')}`
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64')
  return signature.split(' ').some((part) => {
    const candidate = part.split(',')[1]
    if (!candidate) return false
    const a = Buffer.from(candidate)
    const b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  })
}

// =========================
// NOTIFICATION SYSTEM
// =========================

async function sendCompletionNotification(campaignId, domain, stats) {
  try {
    console.log(`📧 Sending completion notification for ${campaignId}`)

    const config = DOMAIN_CONFIG[domain]
    if (!config) {
      console.error(`❌ No domain config for ${domain}`)
      return { success: false, error: 'No domain config' }
    }

    const resend = getResendClient(domain)
    const notifyEmail = config.notifyEmail

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #10b981;">✅ Campaign Complete</h2>
        <p><strong>Campaign ID:</strong> ${campaignId}</p>
        <p><strong>Domain:</strong> ${domain}</p>
        <p><strong>Completed At:</strong> ${new Date().toLocaleString()}</p>
        <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Campaign Statistics</h3>
          <p>📧 <strong>Total Emails:</strong> ${stats.total}</p>
          <p>✅ <strong>Sent Successfully:</strong> ${stats.sent}</p>
          <p>❌ <strong>Failed:</strong> ${stats.failed}</p>
          <p>🔄 <strong>Retried:</strong> ${stats.retried || 0}</p>
          <p>📊 <strong>Success Rate:</strong> ${stats.total > 0 ? ((stats.sent / stats.total) * 100).toFixed(1) : 0}%</p>
        </div>
      </div>
    `

    const result = await resend.emails.send({
      from: `Send Blaster <noreply@${domain}>`,
      to: notifyEmail,
      subject: `✅ Campaign Complete: ${campaignId}`,
      html: htmlContent,
    })

    console.log(`✅ Notification sent for ${campaignId}`)
    return { success: true, id: result?.id }
  } catch (err) {
    console.error(`❌ Notification failed for ${campaignId}:`, err.message)
    return { success: false, error: err.message }
  }
}

// =========================
// EMAIL SENDER
// =========================

async function sendSingleEmail(data, resend) {
  try {
    const unsubscribeUrl = getUnsubscribeUrl(data.unsubscribeToken)
    const headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      Precedence: 'bulk',
      'X-Campaign-ID': data.campaignId,
      'X-Mailer': 'SendBlaster-Enterprise/1.0',
    }

    const result = await resend.emails.send({
      from: `${data.fromName} <${data.fromEmail}>`,
      to: data.email,
      subject: data.subject,
      html: appendUnsubscribeFooter(data.html, data.unsubscribeToken),
      headers,
    })
    if (result?.error) {
      return {
        success: false,
        email: data.email,
        error: result.error.message || 'Resend rejected the message.',
      }
    }
    const resendId = result?.data?.id || result?.id
    if (!resendId) {
      return {
        success: false,
        ambiguous: true,
        email: data.email,
        error:
          'Resend response did not include a message ID; manual reconciliation is required before retrying.',
      }
    }

    console.log(`✅ Provider accepted ${data.email} [${data.campaignId}]`)
    return { success: true, email: data.email, resendId }
  } catch (err) {
    console.error(`❌ Failed to send to ${data.email}:`, err.message)
    const ambiguous = !err.statusCode || Number(err.statusCode) >= 500
    return { success: false, ambiguous, email: data.email, error: err.message }
  }
}

// =========================
// DISTRIBUTOR
// =========================

async function distributeEmails() {
  console.log('📦 Distributor starting...')

  try {
    const snapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'pending')
      .limit(CONFIG.BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      console.log('⏭️ No pending emails')
      return { distributed: 0, hasMore: false }
    }

    const docs = snapshot.docs
    const batch = db.batch()
    let distributed = 0

    const workerQueues = ['workerQueue1', 'workerQueue2', 'workerQueue3']

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]
      const data = doc.data()
      const workerIndex = i % 3
      const workerQueue = workerQueues[workerIndex]

      const workerRef = db.collection(workerQueue).doc()
      batch.set(workerRef, {
        ...data,
        originalDocId: doc.id,
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      batch.update(doc.ref, {
        status: 'distributed',
        distributedAt: admin.firestore.FieldValue.serverTimestamp(),
        workerQueue: workerQueue,
        recoveredAt: admin.firestore.FieldValue.delete(),
        recoveryReason: admin.firestore.FieldValue.delete(),
        previousWorkerQueue: admin.firestore.FieldValue.delete(),
        lockedAt: admin.firestore.FieldValue.delete(),
        lockedBy: admin.firestore.FieldValue.delete(),
      })

      distributed++
    }

    await batch.commit()
    console.log(`✅ Distributed ${distributed} emails`)

    const remainingSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'pending')
      .limit(1)
      .get()

    return { distributed, hasMore: !remainingSnapshot.empty }
  } catch (err) {
    console.error('❌ Distributor crashed:', err.message)
    return { distributed: 0, hasMore: false, error: err.message }
  }
}

// =========================
// WORKER
// =========================

async function runWorker(workerQueueName, workerName) {
  console.log(`🚀 ${workerName} starting...`)

  try {
    const snapshot = await db.collection(workerQueueName).limit(CONFIG.BATCH_SIZE).get()

    if (snapshot.empty) {
      console.log(`⏭️ ${workerName}: No emails in ${workerQueueName}`)
      return { processed: 0, sent: 0, failed: 0, hasFailures: false }
    }

    let sent = 0
    let failed = 0
    let skipped = 0
    let hasFailures = false

    for (const doc of snapshot.docs) {
      const data = doc.data()
      const originalDocId = data.originalDocId

      if (!originalDocId) {
        console.error(`❌ ${workerName}: Missing originalDocId, deleting orphan`)
        await doc.ref.delete()
        continue
      }

      const originalRef = db.collection('emailQueue').doc(originalDocId)
      const originalDoc = await originalRef.get()

      if (!originalDoc.exists) {
        console.log(`⚠️ Original doc ${originalDocId} gone, cleaning up`)
        await doc.ref.delete()
        continue
      }

      const originalData = originalDoc.data()

      if (originalData.status === 'sent') {
        console.log(`⚠️ ${data.email} already sent, cleaning up`)
        await doc.ref.delete()
        skipped++
        continue
      }

      if (originalData.status !== 'distributed') {
        console.log(`⚠️ ${data.email} status=${originalData.status}, skipping`)
        await doc.ref.delete()
        skipped++
        continue
      }

      if (originalData.lockedAt) {
        const lockedAt = originalData.lockedAt.toDate
          ? originalData.lockedAt.toDate()
          : new Date(originalData.lockedAt)
        const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
        if (
          minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES &&
          originalData.lockedBy !== workerName
        ) {
          console.log(`⏳ ${data.email} locked by ${originalData.lockedBy}, skipping`)
          continue
        }
      }

      await originalRef.update({
        lockedAt: admin.firestore.FieldValue.serverTimestamp(),
        lockedBy: workerName,
      })

      // Backfill unsubscribe tokens for queue records created before this release.
      if (!data.unsubscribeToken) {
        const legacyToken = crypto.randomBytes(32).toString('hex')
        const legacyTokenHash = sha256(legacyToken)
        data.unsubscribeToken = legacyToken
        data.unsubscribeTokenHash = legacyTokenHash
        const legacyBatch = db.batch()
        legacyBatch.set(db.collection('unsubscribeTokens').doc(legacyTokenHash), {
          email: data.email,
          campaignId: data.campaignId,
          tokenHash: legacyTokenHash,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          active: true,
        })
        legacyBatch.update(originalRef, {
          unsubscribeToken: legacyToken,
          unsubscribeTokenHash: legacyTokenHash,
        })
        legacyBatch.update(doc.ref, {
          unsubscribeToken: legacyToken,
          unsubscribeTokenHash: legacyTokenHash,
        })
        await legacyBatch.commit()
      }

      // Check the suppression list immediately before delivery.
      const suppressionSnap = await db.collection('suppressionList').doc(sha256(data.email)).get()
      if (suppressionSnap.exists) {
        await db.runTransaction(async (t) => {
          t.update(originalRef, {
            status: 'suppressed',
            suppressionReason: suppressionSnap.data().reason || 'Previously opted out',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            lockedAt: admin.firestore.FieldValue.delete(),
            lockedBy: admin.firestore.FieldValue.delete(),
          })
          t.delete(doc.ref)
        })
        skipped++
        continue
      }

      let reservedCycleId
      try {
        reservedCycleId = await reserveUsageSlot(originalDocId)
      } catch (usageErr) {
        await db.runTransaction(async (t) => {
          t.update(originalRef, {
            status: 'blocked',
            error: usageErr.message,
            lockedAt: admin.firestore.FieldValue.delete(),
            lockedBy: admin.firestore.FieldValue.delete(),
          })
          t.delete(doc.ref)
        })
        failed++
        hasFailures = true
        continue
      }

      const domainConfig = DOMAIN_CONFIG[data.domain]

      if (!domainConfig) {
        await releaseUsageReservation(reservedCycleId, originalDocId)
        console.error(`❌ No config for domain ${data.domain}`)
        await db.runTransaction(async (t) => {
          t.update(originalRef, {
            status: 'failed',
            error: `No API key for domain: ${data.domain}`,
            lockedAt: admin.firestore.FieldValue.delete(),
            lockedBy: admin.firestore.FieldValue.delete(),
          })
          t.delete(doc.ref)
        })
        failed++
        hasFailures = true
        continue
      }

      let result
      try {
        const resend = getResendClient(data.domain)
        result = await sendSingleEmail(data, resend)
      } catch (sendSetupError) {
        result = { success: false, ambiguous: false, error: sendSetupError.message }
      }

      try {
        await db.runTransaction(async (t) => {
          const freshDoc = await t.get(originalRef)
          if (!freshDoc.exists) {
            t.delete(doc.ref)
            return
          }

          const freshData = freshDoc.data()

          if (freshData.lockedBy !== workerName) {
            console.warn(`⚠️ Lock stolen on ${data.email}, aborting`)
            return
          }

          if (result.success) {
            const ledgerRef = result.resendId
              ? db.collection('usageLedger').doc(result.resendId)
              : db.collection('usageLedger').doc(originalDocId)
            const ledgerSnap = await t.get(ledgerRef)
            const reservationRef = db.collection('usageReservations').doc(originalDocId)
            const reservationSnap = await t.get(reservationRef)
            const cycleRef = db.collection('usageCycles').doc(reservedCycleId)
            if (!ledgerSnap.exists) {
              t.set(ledgerRef, {
                resendId: result.resendId || null,
                emailQueueId: originalDocId,
                campaignId: freshData.campaignId,
                cycleId: reservedCycleId,
                acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
              })
              t.update(cycleRef, {
                ...(reservationSnap.exists && reservationSnap.data().status === 'reserved'
                  ? { reservedCount: admin.firestore.FieldValue.increment(-1) }
                  : {}),
                acceptedCount: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              })
            } else if (reservationSnap.exists && reservationSnap.data().status === 'reserved') {
              t.update(cycleRef, {
                reservedCount: admin.firestore.FieldValue.increment(-1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              })
            }
            if (reservationSnap.exists && reservationSnap.data().status !== 'accepted') {
              t.update(reservationRef, {
                status: 'accepted',
                resendId: result.resendId || null,
                acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
              })
            }
            t.update(originalRef, {
              status: 'sent',
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              sentEmailId: result.resendId || null,
              attempts: admin.firestore.FieldValue.increment(1),
              lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
              lockedAt: admin.firestore.FieldValue.delete(),
              lockedBy: admin.firestore.FieldValue.delete(),
              error: admin.firestore.FieldValue.delete(),
            })
            sent++
          } else {
            const cycleRef = db.collection('usageCycles').doc(reservedCycleId)
            const reservationRef = db.collection('usageReservations').doc(originalDocId)
            const reservationSnap = await t.get(reservationRef)
            const cycleSnap = await t.get(cycleRef)
            if (
              !result.ambiguous &&
              reservationSnap.exists &&
              reservationSnap.data().status === 'reserved' &&
              cycleSnap.exists &&
              Number(cycleSnap.data().reservedCount || 0) > 0
            ) {
              t.update(cycleRef, {
                reservedCount: admin.firestore.FieldValue.increment(-1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              })
              t.update(reservationRef, {
                status: 'released',
                releasedAt: admin.firestore.FieldValue.serverTimestamp(),
              })
            }
            const currentAttempts = (freshData.attempts || 0) + 1
            const shouldRetry = !result.ambiguous && currentAttempts < CONFIG.MAX_RETRIES

            t.update(originalRef, {
              status: result.ambiguous ? 'unknown' : shouldRetry ? 'pending_retry' : 'failed',
              error: result.error,
              attempts: currentAttempts,
              lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
              lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
              lockedAt: admin.firestore.FieldValue.delete(),
              lockedBy: admin.firestore.FieldValue.delete(),
            })
            failed++
            hasFailures = true
          }

          t.delete(doc.ref)
        })
      } catch (txErr) {
        console.error(`❌ Transaction failed for ${data.email}:`, txErr.message)
        if (result.success) {
          // The provider accepted the email. Retry the accounting transaction; never blindly resend.
          try {
            await db.runTransaction(async (t) => {
              const queueSnap = await t.get(originalRef)
              const ledgerRef = db.collection('usageLedger').doc(result.resendId)
              const ledgerSnap = await t.get(ledgerRef)
              const reservationRef = db.collection('usageReservations').doc(originalDocId)
              const reservationSnap = await t.get(reservationRef)
              const cycleRef = db.collection('usageCycles').doc(reservedCycleId)
              if (!queueSnap.exists) return
              if (!ledgerSnap.exists) {
                t.set(ledgerRef, {
                  resendId: result.resendId,
                  emailQueueId: originalDocId,
                  campaignId: data.campaignId,
                  cycleId: reservedCycleId,
                  acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
                })
                t.update(cycleRef, {
                  ...(reservationSnap.exists && reservationSnap.data().status === 'reserved'
                    ? { reservedCount: admin.firestore.FieldValue.increment(-1) }
                    : {}),
                  acceptedCount: admin.firestore.FieldValue.increment(1),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                })
              } else if (reservationSnap.exists && reservationSnap.data().status === 'reserved') {
                t.update(cycleRef, {
                  reservedCount: admin.firestore.FieldValue.increment(-1),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                })
              }
              if (reservationSnap.exists && reservationSnap.data().status !== 'accepted') {
                t.update(reservationRef, {
                  status: 'accepted',
                  resendId: result.resendId,
                  acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
                })
              }
              t.update(originalRef, {
                status: 'sent',
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                sentEmailId: result.resendId,
                lockedAt: admin.firestore.FieldValue.delete(),
                lockedBy: admin.firestore.FieldValue.delete(),
                reconciliationRequired: false,
              })
              t.delete(doc.ref)
            })
            sent++
          } catch (reconcileErr) {
            console.error(
              'Accepted-send reconciliation failed; marking unknown to prevent resend:',
              reconcileErr.message,
            )
            await originalRef.set(
              {
                status: 'unknown',
                error:
                  'Provider accepted the message but Firestore accounting could not be reconciled. Do not resend until manually reviewed.',
                reconciliationRequired: true,
                sentEmailId: result.resendId,
                lockedAt: admin.firestore.FieldValue.delete(),
                lockedBy: admin.firestore.FieldValue.delete(),
              },
              { merge: true },
            )
            await doc.ref.delete()
            failed++
            hasFailures = true
          }
        } else {
          try {
            await releaseUsageReservation(reservedCycleId, originalDocId)
          } catch (releaseErr) {
            console.error('Usage reservation release failed:', releaseErr.message)
          }
          try {
            await originalRef.update({
              lockedAt: admin.firestore.FieldValue.delete(),
              lockedBy: admin.firestore.FieldValue.delete(),
            })
          } catch (unlockErr) {
            console.error(`❌ Failed to unlock ${data.email}:`, unlockErr.message)
          }
        }
      }

      if (snapshot.docs.indexOf(doc) < snapshot.docs.length - 1) {
        await sleep(CONFIG.EMAIL_INTERVAL_MS)
      }
    }

    console.log(`✅ ${workerName}: ${sent} sent, ${failed} failed, ${skipped} skipped`)

    const moreSnapshot = await db.collection(workerQueueName).limit(1).get()

    return {
      processed: snapshot.docs.length,
      sent,
      failed,
      skipped,
      hasFailures,
      hasMore: !moreSnapshot.empty,
    }
  } catch (err) {
    console.error(`❌ ${workerName} crashed:`, err.message)
    return { processed: 0, sent: 0, failed: 0, hasFailures: true, error: err.message }
  }
}

// =========================
// RETRY WORKER
// =========================

async function runRetryWorker() {
  console.log('🔄 Retry Worker starting...')

  try {
    const snapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'pending_retry')
      .limit(CONFIG.BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      console.log('⏭️ No emails for retry')
      return { reset: 0, hasMore: false }
    }

    let reset = 0

    for (const doc of snapshot.docs) {
      const data = doc.data()
      const lastAttempt = data.lastAttempt?.toDate?.() || new Date(0)
      const minutesSince = (Date.now() - lastAttempt.getTime()) / (60 * 1000)

      if (minutesSince < CONFIG.RETRY_DELAY_MINUTES) {
        console.log(`⏳ Too soon for ${data.email} (${Math.floor(minutesSince)}m ago)`)
        continue
      }

      if (data.lockedAt) {
        const lockedAt = data.lockedAt.toDate ? data.lockedAt.toDate() : new Date(data.lockedAt)
        const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
        if (minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES) {
          console.log(`⏳ ${data.email} currently locked, skipping`)
          continue
        }
      }

      await doc.ref.update({
        status: 'pending',
        retryCount: admin.firestore.FieldValue.increment(1),
        resetAt: admin.firestore.FieldValue.serverTimestamp(),
        lockedAt: admin.firestore.FieldValue.delete(),
        lockedBy: admin.firestore.FieldValue.delete(),
        workerQueue: admin.firestore.FieldValue.delete(),
        distributedAt: admin.firestore.FieldValue.delete(),
      })

      reset++
      console.log(`🔄 Reset ${data.email} to pending`)
    }

    const moreSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'pending_retry')
      .limit(1)
      .get()

    return { reset, hasMore: !moreSnapshot.empty }
  } catch (err) {
    console.error('❌ Retry Worker crashed:', err.message)
    return { reset: 0, hasMore: false, error: err.message }
  }
}

// =========================
// CAMPAIGN COMPLETION CHECKER
// =========================

async function checkCampaignCompletion() {
  console.log('📊 Checking campaign completion...')

  try {
    const pendingSnapshot = await db
      .collection('emailQueue')
      .where('status', 'in', ['pending', 'pending_retry', 'distributed', 'unknown'])
      .limit(1)
      .get()

    if (!pendingSnapshot.empty) {
      console.log('⏳ Active campaigns still in progress')
      return { completed: 0, hasMore: true }
    }

    const fiveMinutesAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000))

    const [sentSnapshot, failedSnapshot] = await Promise.all([
      db
        .collection('emailQueue')
        .where('status', '==', 'sent')
        .where('sentAt', '>=', fiveMinutesAgo)
        .get(),
      db
        .collection('emailQueue')
        .where('status', '==', 'failed')
        .where('lastAttempt', '>=', fiveMinutesAgo)
        .get(),
    ])

    const allDocs = [...sentSnapshot.docs, ...failedSnapshot.docs]

    if (allDocs.length === 0) {
      console.log('ℹ️ No recently completed campaigns')
      return { completed: 0, hasMore: false }
    }

    const campaigns = {}
    allDocs.forEach((doc) => {
      const data = doc.data()
      if (!campaigns[data.campaignId]) {
        campaigns[data.campaignId] = {
          domain: data.domain,
          total: 0,
          sent: 0,
          failed: 0,
          notified: false,
        }
      }
      campaigns[data.campaignId].total++
      if (data.status === 'sent') campaigns[data.campaignId].sent++
      else campaigns[data.campaignId].failed++
    })

    for (const campaignId of Object.keys(campaigns)) {
      try {
        const campaignDoc = await db.collection('campaigns').doc(campaignId).get()
        if (campaignDoc.exists && campaignDoc.data().notificationSent) {
          campaigns[campaignId].notified = true
        }
      } catch (e) {
        console.warn(`⚠️ Could not check campaign ${campaignId}:`, e.message)
      }
    }

    let completed = 0

    for (const [campaignId, stats] of Object.entries(campaigns)) {
      if (stats.notified) {
        console.log(`⏭️ ${campaignId} already notified`)
        continue
      }

      const campaignPending = await db
        .collection('emailQueue')
        .where('campaignId', '==', campaignId)
        .where('status', 'in', ['pending', 'pending_retry', 'distributed'])
        .limit(1)
        .get()

      if (!campaignPending.empty) {
        console.log(`⏳ ${campaignId} still has pending emails`)
        continue
      }

      const campaignDoc = await db.collection('campaigns').doc(campaignId).get()
      const campaignData = campaignDoc.exists ? campaignDoc.data() : {}
      const domain = campaignData.domain || stats.domain

      console.log(`🎯 ${campaignId} is complete!`)

      let notificationSuccess = false
      let notificationError = null

      try {
        const notifyResult = await sendCompletionNotification(campaignId, domain, stats)
        if (notifyResult.success) {
          notificationSuccess = true
        } else {
          notificationError = notifyResult.error
        }
      } catch (notifyErr) {
        notificationError = notifyErr.message
      }

      await db
        .collection('campaigns')
        .doc(campaignId)
        .set(
          {
            status: 'completed',
            notificationSent: notificationSuccess,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            stats,
            ...(notificationError ? { notificationError } : {}),
            ...(notificationSuccess
              ? { notificationError: admin.firestore.FieldValue.delete() }
              : {}),
          },
          { merge: true },
        )

      completed++
      console.log(`💾 ${campaignId} marked completed`)
    }

    return { completed, hasMore: false }
  } catch (err) {
    console.error('❌ Completion check failed:', err.message)
    return { completed: 0, hasMore: false, error: err.message }
  }
}

// =========================
// RECOVERY
// =========================

async function recoverOrphanedEmails() {
  console.log('🔍 Recovery: Scanning for orphaned emails...')

  const now = admin.firestore.Timestamp.now()
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - CONFIG.ORPHAN_THRESHOLD_MINUTES * 60 * 1000),
  )

  try {
    const distributedSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'distributed')
      .where('distributedAt', '<=', cutoff)
      .limit(50)
      .get()

    if (distributedSnapshot.empty) {
      console.log('✅ No orphaned emails found')
      return { recovered: 0, hasMore: false }
    }

    let recovered = 0
    let stillInWorkerQueue = 0
    let recentlyLocked = 0

    for (const doc of distributedSnapshot.docs) {
      const data = doc.data()

      if (data.lockedAt) {
        const lockedAt = data.lockedAt.toDate ? data.lockedAt.toDate() : new Date(data.lockedAt)
        const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
        if (minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES) {
          recentlyLocked++
          continue
        }
      }

      const workerQueue = data.workerQueue
      const originalDocId = doc.id

      if (!workerQueue) {
        await doc.ref.update({
          status: 'pending',
          recoveredAt: now,
          recoveryReason: 'missing_workerQueue_field',
          lockedAt: admin.firestore.FieldValue.delete(),
          lockedBy: admin.firestore.FieldValue.delete(),
        })
        recovered++
        continue
      }

      const workerDocs = await db
        .collection(workerQueue)
        .where('originalDocId', '==', originalDocId)
        .limit(1)
        .get()

      if (workerDocs.empty) {
        await doc.ref.update({
          status: 'pending',
          recoveredAt: now,
          recoveryReason: `worker_queue_doc_missing_in_${workerQueue}`,
          previousWorkerQueue: workerQueue,
          workerQueue: admin.firestore.FieldValue.delete(),
          distributedAt: admin.firestore.FieldValue.delete(),
          lockedAt: admin.firestore.FieldValue.delete(),
          lockedBy: admin.firestore.FieldValue.delete(),
        })
        recovered++
      } else {
        stillInWorkerQueue++
      }
    }

    const moreSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'distributed')
      .where('distributedAt', '<=', cutoff)
      .limit(1)
      .get()

    return {
      recovered,
      checked: distributedSnapshot.size,
      stillInWorkerQueue,
      recentlyLocked,
      hasMore: !moreSnapshot.empty,
    }
  } catch (err) {
    console.error('❌ Recovery crashed:', err.message)
    return { recovered: 0, hasMore: false, error: err.message }
  }
}

// =========================
// TASK QUEUE FUNCTIONS (Firebase v2 onTaskDispatched)
// These auto-create their own queues and handle auth internally
// =========================

// Task queue config
const taskQueueConfig = {
  memory: '512MiB',
  timeoutSeconds: 120,
  maxInstances: 1,
  retryConfig: {
    maxAttempts: 3,
    minBackoffSeconds: 10,
  },
  rateLimits: {
    maxConcurrentDispatches: 1,
  },
}

// 2. DISTRIBUTOR TASK
exports.emailDistributor = onTaskDispatched(
  {
    ...taskQueueConfig,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req) => {
    console.log('📥 Distributor task invoked')
    const distResult = await distributeEmails()

    if (distResult.distributed > 0) {
      await Promise.all([
        enqueueTask(
          'emailWorker',
          { workerQueue: 'workerQueue1', workerName: 'Worker-1' },
          { scheduleDelaySeconds: 2 },
        ),
        enqueueTask(
          'emailWorker',
          { workerQueue: 'workerQueue2', workerName: 'Worker-2' },
          { scheduleDelaySeconds: 3 },
        ),
        enqueueTask(
          'emailWorker',
          { workerQueue: 'workerQueue3', workerName: 'Worker-3' },
          { scheduleDelaySeconds: 4 },
        ),
      ])
    }

    if (distResult.hasMore) {
      await enqueueTask('emailDistributor', {}, { scheduleDelaySeconds: 5 })
    }

    console.log('✅ Distributor task complete:', distResult)
  },
)

// 3. WORKER TASK
exports.emailWorker = onTaskDispatched(
  {
    ...taskQueueConfig,
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 3,
  },
  async (req) => {
    console.log('📥 Worker task invoked')
    const { workerQueue, workerName } = req.data
    const result = await runWorker(workerQueue, workerName)

    if (result.hasMore) {
      await enqueueTask('emailWorker', { workerQueue, workerName }, { scheduleDelaySeconds: 2 })
    }

    if (result.hasFailures) {
      await enqueueTask('emailRetry', {}, { scheduleDelaySeconds: 60 })
    }

    await enqueueTask('emailCompletion', {}, { scheduleDelaySeconds: 10 })

    console.log('✅ Worker task complete:', result)
  },
)

// 4. RETRY TASK
exports.emailRetry = onTaskDispatched(
  {
    ...taskQueueConfig,
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (req) => {
    console.log('📥 Retry task invoked')
    const result = await runRetryWorker()

    if (result.hasMore) {
      await enqueueTask('emailRetry', {}, { scheduleDelaySeconds: 300 })
    }

    if (result.reset > 0) {
      await enqueueTask('emailDistributor', {}, { scheduleDelaySeconds: 5 })
    }

    console.log('✅ Retry task complete:', result)
  },
)

// 5. COMPLETION TASK
exports.emailCompletion = onTaskDispatched(
  {
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 1 },
  },
  async (req) => {
    console.log('📥 Completion task invoked')
    const result = await checkCampaignCompletion()

    if (result.hasMore) {
      await enqueueTask('emailCompletion', {}, { scheduleDelaySeconds: 30 })
    }

    console.log('✅ Completion task complete:', result)
  },
)

// 6. RECOVERY TASK
exports.emailRecovery = onTaskDispatched(
  {
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 1 },
  },
  async (req) => {
    console.log('📥 Recovery task invoked')
    const result = await recoverOrphanedEmails()

    if (result.hasMore) {
      await enqueueTask('emailRecovery', {}, { scheduleDelaySeconds: 120 })
    }

    if (result.recovered > 0) {
      await enqueueTask('emailDistributor', {}, { scheduleDelaySeconds: 5 })
    }

    console.log('✅ Recovery task complete:', result)
  },
)

// Public unsubscribe endpoint. GET displays a confirmation page; POST performs RFC 8058 one-click opt-out.
exports.unsubscribe = onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const token = String(req.query.token || req.body?.token || '').trim()
  if (!token || token.length > 256) return res.status(400).send('Invalid unsubscribe link.')
  const tokenHash = sha256(token)
  const tokenRef = db.collection('unsubscribeTokens').doc(tokenHash)
  try {
    const tokenSnap = await tokenRef.get()
    if (!tokenSnap.exists)
      return res.status(404).send('This unsubscribe link is invalid or has expired.')
    const record = tokenSnap.data()
    const suppressionRef = db.collection('suppressionList').doc(sha256(record.email))
    if (!record.active) {
      const suppressed = await suppressionRef.get()
      return suppressed.exists
        ? res.status(200).send('You have been unsubscribed.')
        : res.status(404).send('This unsubscribe link has expired.')
    }
    const isOneClick = req.method === 'POST'
    if (isOneClick) {
      await db.runTransaction(async (tx) => {
        tx.set(
          suppressionRef,
          {
            email: record.email,
            reason: 'unsubscribe',
            source: 'recipient_unsubscribe',
            campaignId: record.campaignId || null,
            tokenHash,
            suppressedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        tx.update(tokenRef, { active: false, usedAt: admin.firestore.FieldValue.serverTimestamp() })
      })
      return res.status(200).send('You have been unsubscribed.')
    }
    if (req.method !== 'GET') return res.status(405).send('Method not allowed.')
    return res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:Arial,sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#111827"><h2>Unsubscribe from these emails?</h2><p>Confirm below to stop receiving further emails from this sender.</p><form method="POST"><input type="hidden" name="token" value="${token.replace(/[&<>"']/g, '')}"><button style="padding:12px 18px;background:#111827;color:white;border:0;border-radius:8px;cursor:pointer">Confirm unsubscribe</button></form></body></html>`,
      )
  } catch (err) {
    console.error('Unsubscribe endpoint error:', err)
    return res.status(500).send('Unable to process your request right now.')
  }
})

// Resend webhook: deduplicates Svix event IDs and suppresses hard bounces/complaints.
exports.resendWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed.')
  try {
    if (!verifyResendWebhook(req)) return res.status(401).send('Invalid webhook signature.')
    const eventId = req.get('svix-id')
    const eventRef = db.collection('emailEvents').doc(eventId)
    const existing = await eventRef.get()
    if (existing.exists) return res.status(200).send('Already processed.')
    const payload = req.body || {}
    const eventType = payload.type || 'unknown'
    const eventData = payload.data || {}
    const email = String(
      Array.isArray(eventData.to) ? eventData.to[0] : eventData.to || eventData.email || '',
    )
      .trim()
      .toLowerCase()
    const providerEmailId = eventData.email_id || eventData.id
    const matchingQueue = providerEmailId
      ? await db.collection('emailQueue').where('sentEmailId', '==', providerEmailId).limit(1).get()
      : null
    await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef)
      if (eventSnap.exists) return
      const matchedQueueRef =
        matchingQueue && !matchingQueue.empty ? matchingQueue.docs[0].ref : null
      const matchedQueueSnap = matchedQueueRef ? await tx.get(matchedQueueRef) : null
      const deliveryStatus =
        eventType === 'email.delivered'
          ? 'delivered'
          : eventType === 'email.bounced'
            ? 'bounced'
            : eventType === 'email.complained'
              ? 'complained'
              : null
      let ledgerRef = null
      let ledgerSnap = null
      let reservationRef = null
      let reservationSnap = null
      let cycleRef = null
      let cycleSnap = null
      if (matchedQueueSnap?.exists && providerEmailId) {
        const queueData = matchedQueueSnap.data()
        ledgerRef = db.collection('usageLedger').doc(providerEmailId)
        ledgerSnap = await tx.get(ledgerRef)
        reservationRef = db.collection('usageReservations').doc(matchedQueueRef.id)
        reservationSnap = await tx.get(reservationRef)
        if (reservationSnap.exists && reservationSnap.data().cycleId) {
          cycleRef = db.collection('usageCycles').doc(reservationSnap.data().cycleId)
          cycleSnap = await tx.get(cycleRef)
        }
      }
      tx.set(eventRef, {
        eventId,
        type: eventType,
        email: email || null,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      if (matchedQueueSnap?.exists && deliveryStatus) {
        tx.update(matchedQueueRef, {
          deliveryStatus,
          ...(matchedQueueSnap.data().status === 'unknown'
            ? {
                status: 'sent',
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                reconciliationRequired: false,
              }
            : {}),
          lastProviderEventAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        if (ledgerRef && !ledgerSnap.exists) {
          tx.set(ledgerRef, {
            resendId: providerEmailId,
            emailQueueId: matchedQueueRef.id,
            campaignId: matchedQueueSnap.data().campaignId,
            cycleId: reservationSnap?.data()?.cycleId || null,
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            reconciledFromWebhook: true,
          })
          if (cycleSnap?.exists) {
            tx.update(cycleRef, {
              ...(reservationSnap.exists && reservationSnap.data().status === 'reserved'
                ? { reservedCount: admin.firestore.FieldValue.increment(-1) }
                : {}),
              acceptedCount: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            })
          }
        } else if (
          reservationSnap?.exists &&
          reservationSnap.data().status === 'reserved' &&
          cycleSnap?.exists
        ) {
          tx.update(cycleRef, {
            reservedCount: admin.firestore.FieldValue.increment(-1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        }
        if (reservationSnap?.exists && reservationSnap.data().status === 'reserved') {
          tx.update(reservationRef, {
            status: 'accepted',
            resendId: providerEmailId,
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        }
      }
      if (email && (eventType === 'email.bounced' || eventType === 'email.complained')) {
        tx.set(
          db.collection('suppressionList').doc(sha256(email)),
          {
            email,
            reason: eventType === 'email.complained' ? 'complaint' : 'bounce',
            source: 'resend_webhook',
            providerEventId: eventId,
            suppressedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }
    })
    return res.status(200).send('Webhook processed.')
  } catch (err) {
    console.error('Resend webhook error:', err)
    return res.status(500).send('Webhook processing failed.')
  }
})

// =========================
// CALLABLE FUNCTIONS
// =========================

// 1. SEND BLASTER
exports.sendBlaster = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 540,
    maxInstances: 10,
  },
  async (request) => {
    try {
      if (!request.auth)
        throw new HttpsError('unauthenticated', 'Sign in before creating a campaign.')
      let { emails, subject, html, fromName, fromEmail, domain } = request.data

      if (!domain || !DOMAIN_CONFIG[domain]) {
        throw new HttpsError('invalid-argument', 'Invalid or missing domain')
      }
      if (!subject || !subject.trim()) {
        throw new HttpsError('invalid-argument', 'Subject is required')
      }
      if (!html || !html.trim()) {
        throw new HttpsError('invalid-argument', 'HTML content is required')
      }
      if (!fromName || !fromName.trim()) {
        throw new HttpsError('invalid-argument', 'From name is required')
      }
      if (!fromEmail || !fromEmail.includes('@')) {
        throw new HttpsError('invalid-argument', 'Valid from email is required')
      }

      // Validate that the API key exists before queuing
      try {
        getApiKey(domain)
      } catch (keyErr) {
        throw new HttpsError('internal', keyErr.message)
      }

      if (typeof emails === 'string') {
        emails = emails.split(/[\n,\s]+/)
      }
      if (!Array.isArray(emails)) {
        throw new HttpsError(
          'invalid-argument',
          'Emails must be provided as a list or newline-separated text.',
        )
      }

      const validEmails = emails.map(sanitizeEmail).filter((e) => e && isValidEmail(e))
      const invalidEmails = emails.map(sanitizeEmail).filter((e) => e && !isValidEmail(e))

      if (validEmails.length === 0) {
        throw new HttpsError('invalid-argument', 'No valid emails provided')
      }

      if (!process.env.UNSUBSCRIBE_BASE_URL) {
        throw new HttpsError(
          'failed-precondition',
          'UNSUBSCRIBE_BASE_URL must be configured before sending.',
        )
      }
      validEmails = [...new Set(validEmails)]
      const campaignId = generateCampaignId(domain)
      const timestamp = admin.firestore.FieldValue.serverTimestamp()
      const campaignRef = db.collection('campaigns').doc(campaignId)
      await campaignRef.set({
        campaignId,
        domain,
        fromName,
        fromEmail,
        subject,
        totalEmails: validEmails.length,
        invalidEmails: invalidEmails.length,
        status: 'queued',
        createdAt: timestamp,
        notificationSent: false,
      })

      // Each recipient creates a queue doc and token doc; 200 recipients = 400 writes, below Firestore's 500-write limit.
      for (let offset = 0; offset < validEmails.length; offset += 200) {
        const batch = db.batch()
        const chunk = validEmails.slice(offset, offset + 200)
        chunk.forEach((email) => {
          const ref = db.collection('emailQueue').doc()
          const unsubscribeToken = crypto.randomBytes(32).toString('hex')
          const tokenHash = sha256(unsubscribeToken)
          batch.set(db.collection('unsubscribeTokens').doc(tokenHash), {
            email,
            campaignId,
            tokenHash,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
          })
          batch.set(ref, {
            email,
            unsubscribeToken,
            unsubscribeTokenHash: tokenHash,
            subject,
            html,
            campaignId,
            fromName,
            fromEmail,
            domain,
            status: 'pending',
            attempts: 0,
            retryCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        })
        await batch.commit()
      }

      // 🚀 TRIGGER DISTRIBUTOR via Firebase Task Queue
      const enqueueResult = await enqueueTask(
        'emailDistributor',
        { campaignId },
        { scheduleDelaySeconds: 3 },
      )
      if (!enqueueResult.success) {
        console.error('❌ Failed to enqueue distributor:', enqueueResult.error)
      }

      console.log(`✅ Campaign ${campaignId} queued: ${validEmails.length} emails`)

      return {
        success: true,
        campaignId,
        queued: validEmails.length,
        invalid: invalidEmails.length,
        message: `Campaign queued for processing. Sending is subject to your active 30-day allowance and suppression checks.`,
      }
    } catch (err) {
      console.error('❌ sendBlaster error:', err)
      if (err instanceof HttpsError) throw err
      throw new HttpsError('internal', err.message)
    }
  },
)

// 7. GET CAMPAIGN STATUS
exports.getCampaignStatus = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 10,
  },
  async (request) => {
    try {
      const { campaignId } = request.data
      if (!campaignId) {
        throw new HttpsError('invalid-argument', 'Campaign ID required')
      }

      const campaignDoc = await db.collection('campaigns').doc(campaignId).get()
      if (!campaignDoc.exists) {
        throw new HttpsError('not-found', 'Campaign not found')
      }

      const stats = await db.collection('emailQueue').where('campaignId', '==', campaignId).get()

      const statusCounts = {
        pending: 0,
        sent: 0,
        failed: 0,
        pending_retry: 0,
        distributed: 0,
        suppressed: 0,
        blocked: 0,
        unknown: 0,
      }
      const deliveryCounts = { delivered: 0, bounced: 0, complained: 0 }
      stats.docs.forEach((doc) => {
        const row = doc.data()
        const status = row.status
        if (statusCounts[status] !== undefined) statusCounts[status]++
        if (deliveryCounts[row.deliveryStatus] !== undefined) deliveryCounts[row.deliveryStatus]++
      })

      return {
        campaign: campaignDoc.data(),
        stats: statusCounts,
        delivery: deliveryCounts,
        progress: {
          total: stats.size,
          completed:
            statusCounts.sent +
            statusCounts.failed +
            statusCounts.suppressed +
            statusCounts.blocked,
          percentage:
            stats.size > 0
              ? Math.round(
                  ((statusCounts.sent +
                    statusCounts.failed +
                    statusCounts.suppressed +
                    statusCounts.blocked) /
                    stats.size) *
                    100,
                )
              : 0,
        },
      }
    } catch (err) {
      console.error('❌ getCampaignStatus error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// 8. GET ALL CAMPAIGNS
exports.getCampaigns = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 10,
  },
  async (request) => {
    try {
      const snapshot = await db.collection('campaigns').orderBy('createdAt', 'desc').limit(50).get()
      const campaigns = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      return { campaigns }
    } catch (err) {
      console.error('❌ getCampaigns error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// 9. GET MONTHLY STATS
exports.getMonthlyStats = onCall(
  { memory: '256MiB', timeoutSeconds: 30, maxInstances: 10 },
  async () => {
    try {
      const settingsSnap = await USAGE_SETTINGS_REF().get()
      const cycleId = settingsSnap.exists ? settingsSnap.data().activeCycleId : null
      if (!cycleId)
        return {
          active: false,
          sent: 0,
          limit: USAGE_LIMIT,
          remaining: USAGE_LIMIT,
          percentage: 0,
          cycle: null,
          history: [],
        }
      const cycleSnap = await db.collection('usageCycles').doc(cycleId).get()
      const cycle = cycleSnap.exists ? cycleSnap.data() : null
      const historySnap = await db
        .collection('usageCycles')
        .orderBy('createdAt', 'desc')
        .limit(12)
        .get()
      const sent = Number(cycle?.acceptedCount || 0)
      const limit = Number(cycle?.allowance || USAGE_LIMIT)
      const reserved = Number(cycle?.reservedCount || 0)
      const remaining = Math.max(0, limit - sent - reserved)
      return {
        active: Boolean(
          cycle && cycle.status === 'active' && cycle.cycleEndsAt?.toMillis?.() > Date.now(),
        ),
        sent,
        reserved,
        limit,
        remaining,
        percentage: limit ? Math.min(100, Math.round((sent / limit) * 100)) : 0,
        cycle: cycle ? { ...cycle, id: cycleId } : null,
        history: historySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      }
    } catch (err) {
      console.error('❌ getMonthlyStats error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// Manually activate or restart a rolling 30-day allowance. Restarting closes, never overwrites, history.
exports.activateUsageCycle = onCall(
  { memory: '256MiB', timeoutSeconds: 30, maxInstances: 1 },
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Sign in to activate a sending cycle.')
    const restart = Boolean(request.data?.restart)
    const now = admin.firestore.Timestamp.now()
    const cycleId = `cycle_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const cycleRef = db.collection('usageCycles').doc(cycleId)
    await db.runTransaction(async (tx) => {
      const settingsRef = USAGE_SETTINGS_REF()
      const settingsSnap = await tx.get(settingsRef)
      const oldId = settingsSnap.exists ? settingsSnap.data().activeCycleId : null
      if (oldId && !restart) {
        const oldRef = db.collection('usageCycles').doc(oldId)
        const oldSnap = await tx.get(oldRef)
        if (oldSnap.exists) {
          const old = oldSnap.data()
          const oldEnd = old.cycleEndsAt?.toMillis?.() || 0
          if (old.status === 'active' && oldEnd > Date.now()) {
            throw new HttpsError(
              'failed-precondition',
              'A cycle is already active. Confirm restart to begin a fresh 30-day cycle.',
            )
          }
        }
      }
      if (oldId) {
        const oldRef = db.collection('usageCycles').doc(oldId)
        const oldSnap = await tx.get(oldRef)
        if (oldSnap.exists && oldSnap.data().status === 'active') {
          tx.update(oldRef, {
            status: 'closed',
            closedAt: admin.firestore.FieldValue.serverTimestamp(),
            closeReason: restart ? 'manual_restart' : 'expired',
          })
        }
      }
      tx.set(cycleRef, {
        cycleId,
        status: 'active',
        allowance: USAGE_LIMIT,
        acceptedCount: 0,
        reservedCount: 0,
        cycleStartedAt: now,
        cycleEndsAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
        activatedBy: request.auth.uid,
        createdAt: now,
      })
      tx.set(
        settingsRef,
        { activeCycleId: cycleId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      )
    })
    return { success: true, cycleId, limit: USAGE_LIMIT, durationDays: 30 }
  },
)

// 10. GET CAMPAIGN EMAILS
exports.getCampaignEmails = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async (request) => {
    try {
      const { campaignId, pageSize = 500, lastDocId } = request.data
      if (!campaignId) {
        throw new HttpsError('invalid-argument', 'Campaign ID is required')
      }

      let query = db
        .collection('emailQueue')
        .where('campaignId', '==', campaignId)
        .orderBy('createdAt', 'desc')
        .limit(Math.min(pageSize, 1000))

      if (lastDocId) {
        const lastDoc = await db.collection('emailQueue').doc(lastDocId).get()
        if (lastDoc.exists) query = query.startAfter(lastDoc)
      }

      const snapshot = await query.get()

      if (snapshot.empty) {
        return { emails: [], totalFetched: 0, hasMore: false, lastDocId: null }
      }

      const emails = snapshot.docs.map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          email: data.email,
          status: data.status,
          attempts: data.attempts || 0,
          retryCount: data.retryCount || 0,
          error: data.error || null,
          createdAt: data.createdAt?.toDate?.() || null,
          sentAt: data.sentAt?.toDate?.() || null,
          lastAttempt: data.lastAttempt?.toDate?.() || null,
          distributedAt: data.distributedAt?.toDate?.() || null,
          workerQueue: data.workerQueue || null,
        }
      })

      const lastDoc = snapshot.docs[snapshot.docs.length - 1]
      const nextQuery = db
        .collection('emailQueue')
        .where('campaignId', '==', campaignId)
        .orderBy('createdAt', 'desc')
        .startAfter(lastDoc)
        .limit(1)
      const nextSnapshot = await nextQuery.get()

      return {
        emails,
        totalFetched: emails.length,
        hasMore: !nextSnapshot.empty,
        lastDocId: lastDoc.id,
      }
    } catch (err) {
      console.error('❌ getCampaignEmails error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// 11. EXPORT CAMPAIGN EMAILS
exports.exportCampaignEmails = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 3,
  },
  async (request) => {
    try {
      const { campaignId } = request.data
      if (!campaignId) throw new HttpsError('invalid-argument', 'Campaign ID required')

      const allEmails = []
      let lastDocId = null
      let hasMore = true
      const batchSize = 1000

      while (hasMore && allEmails.length < 50000) {
        let query = db
          .collection('emailQueue')
          .where('campaignId', '==', campaignId)
          .orderBy('createdAt', 'desc')
          .limit(batchSize)

        if (lastDocId) {
          const lastDoc = await db.collection('emailQueue').doc(lastDocId).get()
          if (lastDoc.exists) query = query.startAfter(lastDoc)
        }

        const snapshot = await query.get()
        if (snapshot.empty) {
          hasMore = false
          break
        }

        snapshot.docs.forEach((doc) => {
          const data = doc.data()
          allEmails.push({
            email: data.email,
            status: data.status,
            attempts: data.attempts || 0,
            retryCount: data.retryCount || 0,
            error: data.error || '',
            createdAt: data.createdAt?.toDate?.().toISOString() || '',
            sentAt: data.sentAt?.toDate?.().toISOString() || '',
            lastAttempt: data.lastAttempt?.toDate?.().toISOString() || '',
            distributedAt: data.distributedAt?.toDate?.().toISOString() || '',
            workerQueue: data.workerQueue || '',
          })
        })

        lastDocId = snapshot.docs[snapshot.docs.length - 1].id

        const checkQuery = db
          .collection('emailQueue')
          .where('campaignId', '==', campaignId)
          .orderBy('createdAt', 'desc')
          .startAfter(snapshot.docs[snapshot.docs.length - 1])
          .limit(1)
        const checkSnapshot = await checkQuery.get()
        hasMore = !checkSnapshot.empty
      }

      const campaignDoc = await db.collection('campaigns').doc(campaignId).get()
      const campaignInfo = campaignDoc.exists ? campaignDoc.data() : {}

      return {
        campaign: {
          campaignId,
          domain: campaignInfo.domain || '',
          fromName: campaignInfo.fromName || '',
          subject: campaignInfo.subject || '',
          totalEmails: campaignInfo.totalEmails || allEmails.length,
          status: campaignInfo.status || '',
          createdAt: campaignInfo.createdAt?.toDate?.().toISOString() || '',
        },
        emails: allEmails,
        total: allEmails.length,
      }
    } catch (err) {
      console.error('❌ exportCampaignEmails error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// 12. MANUAL RECOVERY TRIGGER
exports.triggerRecovery = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 1,
  },
  async (request) => {
    try {
      const result = await enqueueTask('emailRecovery', {}, { scheduleDelaySeconds: 5 })
      if (!result.success) {
        throw new HttpsError('internal', `Failed to enqueue recovery: ${result.error}`)
      }
      return { success: true, message: 'Recovery job queued' }
    } catch (err) {
      console.error('❌ triggerRecovery error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)
