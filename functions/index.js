const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { Resend } = require('resend')
const admin = require('firebase-admin')

// =========================
// ENTERPRISE CONFIGURATION
// =========================

const DOMAIN_CONFIG = {
  'brick-ken.com': {
    apiKey: 're_5AbpbUNf_8pywfrQ8orkf7Wp9drjXmVwK',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'lightchainwrap.com': {
    apiKey: 're_9gF9Wko2_C6BtGQugmrd8BBkjGgBTMgTM',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },

  'maskongoing.com': {
    apiKey: 're_HgsAgJzr_MaPWmStLaqLw3cdWGT8gz6dJ',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'humanityproo.com': {
    apiKey: 're_VuRz2Ps6_JGp6mNuW3i9fFVvot9sVJW3z',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'eventtapers.com': {
    apiKey: 're_DRV3UjEb_DNmsFo1jVn2WoDWBxnktTiug',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'maulfaq.online': {
    apiKey: 're_TwPi24YN_8xw6viw6nHaRqqcy1bkAWMXY',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
  'solanexx.com': {
    apiKey: 're_4UPq3e7z_NWr5jSeVWCjdqY3fZpmXZUom',
    notifyEmail: 'chandranbajrngi702@gmail.com',
  },
}

// Rate limiting configuration
const CONFIG = {
  // Worker settings - each worker gets its own batch from the distributor
  BATCH_SIZE: 27,

  // Timing
  EMAIL_INTERVAL_MS: 500,

  // Retry settings
  MAX_RETRIES: 2,
  RETRY_DELAY_MINUTES: 5,

  // Campaign completion
  COMPLETION_CHECK_INTERVAL: 'every 1 minutes',

  // Target: 54/min × 60 = 3240/hour
  HOURLY_TARGET: 3240,

  // Recovery settings
  ORPHAN_THRESHOLD_MINUTES: 10, // Increased from 3 to prevent race with active workers
  STUCK_DISTRIBUTED_THRESHOLD_MS: 10 * 60 * 1000, // 10 minutes
  LOCK_TIMEOUT_MINUTES: 15, // If a worker locks an email but doesn't finish
}

admin.initializeApp()
const db = admin.firestore()

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

// =========================
// NOTIFICATION SYSTEM
// =========================

async function sendCompletionNotification(campaignId, domain, stats) {
  try {
    console.log(
      `📧 Attempting to send completion notification for ${campaignId} to ${DOMAIN_CONFIG[domain]?.notifyEmail || DOMAIN_CONFIG['maulfaq.online']?.notifyEmail}`,
    )

    const config = DOMAIN_CONFIG[domain] || DOMAIN_CONFIG['maulfaq.online']

    if (!config) {
      console.error(`❌ No domain config found for ${domain}, falling back to maulfaq.online`)
    }

    console.log(`🔑 Using API key for domain: ${domain || 'maulfaq.online'}`)

    const resend = new Resend(config.apiKey)

    const notifyEmail = config.notifyEmail || 'ayodeleava505@gmail.com'
    console.log(`📨 Sending to: ${notifyEmail}`)

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

        <p style="color: #6b7280; font-size: 12px;">
          This is an automated notification from Send Blaster Enterprise.
        </p>
      </div>
    `

    const result = await resend.emails.send({
      from: `Send Blaster <noreply@${domain || 'maulfaq.online'}>`,
      to: notifyEmail,
      subject: `✅ Campaign Complete: ${campaignId}`,
      html: htmlContent,
    })

    console.log(
      `✅ Completion notification SENT for campaign ${campaignId}. Resend ID: ${result?.id || 'N/A'}`,
    )
    return { success: true, id: result?.id }
  } catch (err) {
    console.error(`❌ Failed to send completion notification for ${campaignId}:`, err.message)
    console.error('Full error:', err)
    return { success: false, error: err.message }
  }
}

// =========================
// EMAIL SENDER
// =========================

async function sendSingleEmail(data, resend) {
  try {
    const headers = {
      'List-Unsubscribe': `<https://${data.domain}/unsubscribe?email=${encodeURIComponent(data.email)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      Precedence: 'bulk',
      'X-Campaign-ID': data.campaignId,
      'X-Mailer': 'SendBlaster-Enterprise/1.0',
    }

    const result = await resend.emails.send({
      from: `${data.fromName} <${data.fromEmail}>`,
      to: data.email,
      subject: data.subject,
      html: data.html,
      headers,
    })

    console.log(`✅ Sent to ${data.email} [${data.campaignId}] ResendID: ${result?.id || 'N/A'}`)
    return { success: true, email: data.email, resendId: result?.id }
  } catch (err) {
    console.error(`❌ Failed to send to ${data.email}: ${err.message}`)
    return { success: false, email: data.email, error: err.message }
  }
}

// =========================
// DISTRIBUTOR — Pulls from main queue and assigns to worker queues
// Runs every 30 seconds, distributes to 3 worker queues
// =========================

async function distributeEmails() {
  console.log('📦 Distributor starting...')

  try {
    // Pull up to 27 pending emails from main queue (9 per worker × 3 workers)
    const snapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'pending')
      .limit(27)
      .get()

    if (snapshot.empty) {
      console.log('⏭️ Distributor: No pending emails')
      return { distributed: 0 }
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

      // Add to worker queue
      const workerRef = db.collection(workerQueue).doc()
      batch.set(workerRef, {
        ...data,
        originalDocId: doc.id,
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      // Mark original as distributed (not pending anymore)
      batch.update(doc.ref, {
        status: 'distributed',
        distributedAt: admin.firestore.FieldValue.serverTimestamp(),
        workerQueue: workerQueue,
        // Clear any old recovery/lock data
        recoveredAt: admin.firestore.FieldValue.delete(),
        recoveryReason: admin.firestore.FieldValue.delete(),
        previousWorkerQueue: admin.firestore.FieldValue.delete(),
        lockedAt: admin.firestore.FieldValue.delete(),
        lockedBy: admin.firestore.FieldValue.delete(),
      })

      distributed++
    }

    await batch.commit()
    console.log(`✅ Distributor: ${distributed} emails distributed to worker queues`)
    return { distributed }
  } catch (err) {
    console.error('❌ Distributor crashed:', err.message)
    return { distributed: 0, error: err.message }
  }
}

// =========================
// WORKER — Processes its own dedicated queue
// FIXED: Idempotent, atomic transactions, lock-based
// =========================

async function runWorker(workerQueueName, workerName) {
  console.log(`🚀 ${workerName} starting...`)

  try {
    // Pull from this worker's dedicated queue
    const snapshot = await db.collection(workerQueueName).limit(CONFIG.BATCH_SIZE).get()

    if (snapshot.empty) {
      console.log(`⏭️ ${workerName}: No emails in ${workerQueueName}`)
      return { processed: 0, sent: 0, failed: 0 }
    }

    let sent = 0
    let failed = 0
    let skipped = 0

    for (const doc of snapshot.docs) {
      const data = doc.data()
      const originalDocId = data.originalDocId

      if (!originalDocId) {
        console.error(`❌ ${workerName}: Missing originalDocId, deleting orphan`)
        await doc.ref.delete()
        continue
      }

      const originalRef = db.collection('emailQueue').doc(originalDocId)

      // ===== IDEMPOTENCY CHECK =====
      // Check if this email is still actually distributed to us
      const originalDoc = await originalRef.get()
      if (!originalDoc.exists) {
        console.log(
          `⚠️ ${workerName}: Original doc ${originalDocId} gone, cleaning up worker queue`,
        )
        await doc.ref.delete()
        continue
      }

      const originalData = originalDoc.data()

      // If already sent, just clean up
      if (originalData.status === 'sent') {
        console.log(`⚠️ ${workerName}: ${data.email} already sent, cleaning up`)
        await doc.ref.delete()
        skipped++
        continue
      }

      // If not distributed or assigned to different worker, skip
      if (originalData.status !== 'distributed') {
        console.log(
          `⚠️ ${workerName}: ${data.email} status=${originalData.status}, not distributed, skipping`,
        )
        await doc.ref.delete()
        skipped++
        continue
      }

      // If another worker has locked it recently, skip
      if (originalData.lockedAt) {
        const lockedAt = originalData.lockedAt.toDate
          ? originalData.lockedAt.toDate()
          : new Date(originalData.lockedAt)
        const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
        if (
          minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES &&
          originalData.lockedBy !== workerName
        ) {
          console.log(
            `⏳ ${workerName}: ${data.email} locked by ${originalData.lockedBy} ${Math.floor(minutesSinceLock)}m ago, skipping`,
          )
          continue // Don't delete from queue, another worker is handling it
        }
      }

      // ===== LOCK THE EMAIL =====
      // Mark that we're processing this email so recovery doesn't grab it
      await originalRef.update({
        lockedAt: admin.firestore.FieldValue.serverTimestamp(),
        lockedBy: workerName,
      })

      const domainConfig = DOMAIN_CONFIG[data.domain]

      if (!domainConfig) {
        console.error(`❌ ${workerName}: No config for domain ${data.domain}`)

        // Atomic update: mark failed + remove from worker queue
        await db.runTransaction(async (t) => {
          t.update(originalRef, {
            status: 'failed',
            error: `No API key configured for domain: ${data.domain}`,
            lockedAt: admin.firestore.FieldValue.delete(),
            lockedBy: admin.firestore.FieldValue.delete(),
          })
          t.delete(doc.ref)
        })

        failed++
        continue
      }

      const resend = new Resend(domainConfig.apiKey)
      const result = await sendSingleEmail(data, resend)

      // ===== ATOMIC UPDATE =====
      // Update original document AND delete from worker queue in one transaction
      try {
        await db.runTransaction(async (t) => {
          // Re-read original doc inside transaction to ensure freshness
          const freshDoc = await t.get(originalRef)
          if (!freshDoc.exists) {
            t.delete(doc.ref)
            return
          }

          const freshData = freshDoc.data()

          // Double-check we still own this
          if (freshData.lockedBy !== workerName) {
            console.warn(`⚠️ ${workerName}: Lock stolen on ${data.email}, aborting`)
            return // Don't delete from queue, let the other worker handle it
          }

          if (result.success) {
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
            const currentAttempts = (freshData.attempts || 0) + 1
            const shouldRetry = currentAttempts < CONFIG.MAX_RETRIES

            t.update(originalRef, {
              status: shouldRetry ? 'pending_retry' : 'failed',
              error: result.error,
              attempts: currentAttempts,
              lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
              lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
              lockedAt: admin.firestore.FieldValue.delete(),
              lockedBy: admin.firestore.FieldValue.delete(),
            })
            failed++
          }

          // Always delete from worker queue
          t.delete(doc.ref)
        })
      } catch (txErr) {
        console.error(`❌ ${workerName}: Transaction failed for ${data.email}:`, txErr.message)
        // Try to unlock so recovery can pick it up
        try {
          await originalRef.update({
            lockedAt: admin.firestore.FieldValue.delete(),
            lockedBy: admin.firestore.FieldValue.delete(),
          })
        } catch (unlockErr) {
          console.error(`❌ ${workerName}: Failed to unlock ${data.email}:`, unlockErr.message)
        }
      }

      // Rate limiting
      if (snapshot.docs.indexOf(doc) < snapshot.docs.length - 1) {
        await sleep(CONFIG.EMAIL_INTERVAL_MS)
      }
    }

    console.log(`✅ ${workerName} complete: ${sent} sent, ${failed} failed, ${skipped} skipped`)
    return { processed: snapshot.docs.length, sent, failed, skipped }
  } catch (err) {
    console.error(`❌ ${workerName} crashed:`, err.message)
    return { processed: 0, sent: 0, failed: 0, error: err.message }
  }
}

// =========================
// RETRY WORKER — Handles failed emails
// Moves pending_retry back to pending for redistribution
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
      console.log('⏭️ Retry Worker: No emails ready for retry')
      return { processed: 0, reset: 0 }
    }

    let reset = 0

    for (const doc of snapshot.docs) {
      const data = doc.data()

      // Check if enough time has passed since last attempt
      const lastAttempt = data.lastAttempt?.toDate?.() || new Date(0)
      const minutesSince = (Date.now() - lastAttempt.getTime()) / (60 * 1000)

      if (minutesSince < CONFIG.RETRY_DELAY_MINUTES) {
        console.log(
          `⏳ Retry Worker: Skipping ${data.email} - too soon (${Math.floor(minutesSince)}m ago)`,
        )
        continue
      }

      // Don't retry if currently locked by a worker
      if (data.lockedAt) {
        const lockedAt = data.lockedAt.toDate ? data.lockedAt.toDate() : new Date(data.lockedAt)
        const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
        if (minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES) {
          console.log(`⏳ Retry Worker: ${data.email} currently locked, skipping`)
          continue
        }
      }

      // Reset to pending so distributor picks it up again
      await doc.ref.update({
        status: 'pending',
        retryCount: admin.firestore.FieldValue.increment(1),
        resetAt: admin.firestore.FieldValue.serverTimestamp(),
        // Clear any lock/assignment data
        lockedAt: admin.firestore.FieldValue.delete(),
        lockedBy: admin.firestore.FieldValue.delete(),
        workerQueue: admin.firestore.FieldValue.delete(),
        distributedAt: admin.firestore.FieldValue.delete(),
      })

      reset++
      console.log(
        `🔄 Retry Worker: Reset ${data.email} to pending (retry ${(data.retryCount || 0) + 1})`,
      )
    }

    console.log(`✅ Retry Worker: ${reset} emails reset to pending for retry`)
    return { processed: snapshot.docs.length, reset }
  } catch (err) {
    console.error('❌ Retry Worker crashed:', err.message)
    return { processed: 0, reset: 0, error: err.message }
  }
}

// =========================
// CAMPAIGN COMPLETION CHECKER
// =========================

async function checkCampaignCompletion() {
  console.log('📊 Checking campaign completion...')

  try {
    // Step 1: Check if any emails are still pending/distributed/locked
    const pendingSnapshot = await db
      .collection('emailQueue')
      .where('status', 'in', ['pending', 'pending_retry', 'distributed'])
      .limit(1)
      .get()

    if (!pendingSnapshot.empty) {
      console.log('⏳ Active campaigns still in progress - skipping completion check')
      return
    }

    // Step 2: Find recently processed emails (sent or failed in last 5 minutes)
    const fiveMinutesAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000))

    console.log(
      '🔍 Looking for recently completed campaigns since:',
      fiveMinutesAgo.toDate().toISOString(),
    )

    // Query 1: Recently SENT emails
    const sentSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'sent')
      .where('sentAt', '>=', fiveMinutesAgo)
      .get()

    // Query 2: Recently FAILED emails
    const failedSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'failed')
      .where('lastAttempt', '>=', fiveMinutesAgo)
      .get()

    // Merge results
    const allDocs = [...sentSnapshot.docs, ...failedSnapshot.docs]
    console.log(
      `📋 Found ${sentSnapshot.size} sent + ${failedSnapshot.size} failed = ${allDocs.length} total recently processed emails`,
    )

    if (allDocs.length === 0) {
      console.log('ℹ️ No recently completed campaigns found')
      return
    }

    // Group by campaign
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

    console.log(
      `📊 Found ${Object.keys(campaigns).length} campaigns to check:`,
      Object.keys(campaigns),
    )

    // Check which campaigns have already been notified
    for (const campaignId of Object.keys(campaigns)) {
      try {
        const campaignDoc = await db.collection('campaigns').doc(campaignId).get()
        if (campaignDoc.exists && campaignDoc.data().notificationSent) {
          campaigns[campaignId].notified = true
          console.log(`✉️ Campaign ${campaignId} already notified`)
        }
      } catch (e) {
        console.warn(`⚠️ Could not check campaign ${campaignId}:`, e.message)
      }
    }

    // Process each un-notified campaign
    for (const [campaignId, stats] of Object.entries(campaigns)) {
      if (stats.notified) {
        console.log(`⏭️ Skipping ${campaignId} - already notified`)
        continue
      }

      // Double-check no pending emails remain for this campaign
      const campaignPending = await db
        .collection('emailQueue')
        .where('campaignId', '==', campaignId)
        .where('status', 'in', ['pending', 'pending_retry', 'distributed'])
        .limit(1)
        .get()

      if (!campaignPending.empty) {
        console.log(`⏳ Campaign ${campaignId} still has pending emails - skipping notification`)
        continue
      }

      // Get campaign document for proper domain and metadata
      const campaignDoc = await db.collection('campaigns').doc(campaignId).get()
      const campaignData = campaignDoc.exists ? campaignDoc.data() : {}
      const domain = campaignData.domain || stats.domain

      console.log(`🎯 Campaign ${campaignId} is complete! Stats:`, stats)

      // Send completion email FIRST (before marking as completed)
      let notificationSuccess = false
      let notificationError = null
      try {
        const notifyResult = await sendCompletionNotification(campaignId, domain, stats)
        if (notifyResult.success) {
          notificationSuccess = true
          console.log(`📧 Completion notification SENT for campaign ${campaignId}`)
        } else {
          notificationError = notifyResult.error
          console.error(`❌ Notification returned failure for ${campaignId}:`, notifyResult.error)
        }
      } catch (notifyErr) {
        notificationError = notifyErr.message
        console.error(`❌ Failed to send notification for ${campaignId}:`, notifyErr.message)
      }

      // Mark campaign as completed
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

      console.log(
        `💾 Campaign ${campaignId} marked as completed in Firestore (notificationSent: ${notificationSuccess})`,
      )
    }
  } catch (err) {
    console.error('❌ Campaign completion check failed:', err.message)
    console.error('Full error:', err)
  }
}

// =========================
// CLOUD FUNCTIONS
// =========================

// 1. QUEUE EMAILS (Callable from frontend)
exports.sendBlaster = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async (request) => {
    try {
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

      if (typeof emails === 'string') {
        emails = emails.split(/[\n,\s]+/)
      }

      const validEmails = emails.map(sanitizeEmail).filter((e) => e && isValidEmail(e))
      const invalidEmails = emails.map(sanitizeEmail).filter((e) => e && !isValidEmail(e))

      if (validEmails.length === 0) {
        throw new HttpsError('invalid-argument', 'No valid emails provided')
      }

      const campaignId = generateCampaignId(domain)
      const batch = db.batch()
      const timestamp = admin.firestore.FieldValue.serverTimestamp()

      const campaignRef = db.collection('campaigns').doc(campaignId)
      batch.set(campaignRef, {
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

      validEmails.forEach((email) => {
        const ref = db.collection('emailQueue').doc()
        batch.set(ref, {
          email,
          subject,
          html,
          campaignId,
          fromName,
          fromEmail,
          domain,
          status: 'pending',
          attempts: 0,
          retryCount: 0,
          createdAt: timestamp,
        })
      })

      await batch.commit()

      // Track monthly usage
      const now = new Date()
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const monthlyRef = db.collection('monthlyStats').doc(currentMonthKey)
      await monthlyRef.set(
        {
          sent: admin.firestore.FieldValue.increment(validEmails.length),
          month: currentMonthKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      console.log(`✅ Campaign ${campaignId} queued: ${validEmails.length} emails`)

      return {
        success: true,
        campaignId,
        queued: validEmails.length,
        invalid: invalidEmails.length,
        message: `Campaign queued successfully. Emails will be sent at ~${CONFIG.HOURLY_TARGET}/hour rate.`,
      }
    } catch (err) {
      console.error('❌ sendBlaster error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// 2. DISTRIBUTOR — Runs first, assigns emails to worker queues, then triggers workers
exports.emailDistributor = onSchedule(
  {
    schedule: 'every 30 seconds',
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    const distResult = await distributeEmails()

    // If we distributed emails, trigger workers immediately
    if (distResult.distributed > 0) {
      console.log('🚀 Triggering workers immediately after distribution...')

      // Run all 3 workers in parallel with small stagger
      await Promise.all([
        runWorker('workerQueue1', 'Worker-1'),
        sleep(1000).then(() => runWorker('workerQueue2', 'Worker-2')),
        sleep(2000).then(() => runWorker('workerQueue3', 'Worker-3')),
      ])
    }
  },
)

// 3-5. WORKERS — REMOVED as scheduled functions to prevent race conditions
// Workers are now ONLY triggered by the distributor after it assigns emails
// This prevents workers from stealing jobs or processing stale queue items

// 6. RETRY WORKER
exports.retryWorker = onSchedule(
  {
    schedule: 'every 5 minutes',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    await runRetryWorker()
  },
)

// 7. CAMPAIGN COMPLETION NOTIFIER
exports.campaignCompletionChecker = onSchedule(
  {
    schedule: CONFIG.COMPLETION_CHECK_INTERVAL,
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    await checkCampaignCompletion()
  },
)

// 8. GET CAMPAIGN STATUS
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

      const statusCounts = { pending: 0, sent: 0, failed: 0, pending_retry: 0, distributed: 0 }
      stats.docs.forEach((doc) => {
        const status = doc.data().status
        if (statusCounts[status] !== undefined) {
          statusCounts[status]++
        }
      })

      return {
        campaign: campaignDoc.data(),
        stats: statusCounts,
        progress: {
          total: stats.size,
          completed: statusCounts.sent + statusCounts.failed,
          percentage:
            stats.size > 0
              ? Math.round(((statusCounts.sent + statusCounts.failed) / stats.size) * 100)
              : 0,
        },
      }
    } catch (err) {
      console.error('❌ getCampaignStatus error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// 9. GET ALL CAMPAIGNS
exports.getCampaigns = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 10,
  },
  async (request) => {
    try {
      const snapshot = await db.collection('campaigns').orderBy('createdAt', 'desc').limit(50).get()

      const campaigns = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      return { campaigns }
    } catch (err) {
      console.error('❌ getCampaigns error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// =========================
// ORPHANED EMAIL RECOVERY
// =========================

/**
 * Finds emails stuck in 'distributed' status that have no corresponding
 * document in their assigned worker queue. Resets them back to 'pending'.
 * FIXED: Respects lock timeouts, longer thresholds to avoid racing active workers.
 */
async function recoverOrphanedEmails() {
  console.log('🔍 Recovery Worker: Scanning for orphaned emails...')

  const now = admin.firestore.Timestamp.now()
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - CONFIG.ORPHAN_THRESHOLD_MINUTES * 60 * 1000),
  )

  try {
    // Find old 'distributed' emails in emailQueue
    const distributedSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'distributed')
      .where('distributedAt', '<=', cutoff)
      .limit(50)
      .get()

    if (distributedSnapshot.empty) {
      console.log('✅ Recovery Worker: No orphaned emails found')
      return { recovered: 0, checked: 0 }
    }

    console.log(`🔍 Recovery Worker: Found ${distributedSnapshot.size} potentially orphaned emails`)

    let recovered = 0
    let stillInWorkerQueue = 0
    let recentlyLocked = 0

    for (const doc of distributedSnapshot.docs) {
      const data = doc.data()

      // Skip if recently locked by an active worker
      if (data.lockedAt) {
        const lockedAt = data.lockedAt.toDate ? data.lockedAt.toDate() : new Date(data.lockedAt)
        const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
        if (minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES) {
          recentlyLocked++
          console.log(
            `⏳ Recovery: ${data.email} locked by ${data.lockedBy} ${Math.floor(minutesSinceLock)}m ago, skipping`,
          )
          continue
        }
      }

      const workerQueue = data.workerQueue
      const originalDocId = doc.id

      if (!workerQueue) {
        // No worker queue assigned — definitely orphaned
        console.log(`🔄 Recovery: ${data.email} has no workerQueue assigned, resetting to pending`)
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

      // Check if the document still exists in the worker queue
      const workerDocs = await db
        .collection(workerQueue)
        .where('originalDocId', '==', originalDocId)
        .limit(1)
        .get()

      if (workerDocs.empty) {
        // Document was in worker queue but is gone — orphaned
        console.log(`🔄 Recovery: ${data.email} orphaned from ${workerQueue}, resetting to pending`)
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
        // Still exists in worker queue — worker just hasn't processed it yet
        stillInWorkerQueue++
        console.log(`⏳ Recovery: ${data.email} still in ${workerQueue}, skipping`)
      }
    }

    console.log(
      `✅ Recovery Worker: ${recovered} recovered, ${stillInWorkerQueue} still in queue, ${recentlyLocked} recently locked, ${distributedSnapshot.size} checked`,
    )
    return { recovered, checked: distributedSnapshot.size, stillInWorkerQueue, recentlyLocked }
  } catch (err) {
    console.error('❌ Recovery Worker crashed:', err.message)
    return { recovered: 0, checked: 0, error: err.message }
  }
}

// Fallback recovery for stuck distributed emails without distributedAt index
async function recoverStuckDistributed() {
  console.log('🔍 Recovery Worker (fallback): Checking for stuck distributed emails...')

  try {
    const snapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'distributed')
      .limit(100)
      .get()

    if (snapshot.empty) {
      return { recovered: 0 }
    }

    const now = Date.now()
    let recovered = 0
    let skippedLocked = 0

    for (const doc of snapshot.docs) {
      const data = doc.data()

      // Skip if recently locked
      if (data.lockedAt) {
        const lockedAt = data.lockedAt.toDate ? data.lockedAt.toDate() : new Date(data.lockedAt)
        const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
        if (minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES) {
          skippedLocked++
          continue
        }
      }

      const distributedAt = data.distributedAt?.toDate?.() || null
      const isOrphaned =
        !distributedAt || now - distributedAt.getTime() > CONFIG.STUCK_DISTRIBUTED_THRESHOLD_MS

      if (isOrphaned) {
        const workerQueue = data.workerQueue
        let inWorkerQueue = false

        if (workerQueue) {
          const workerCheck = await db
            .collection(workerQueue)
            .where('originalDocId', '==', doc.id)
            .limit(1)
            .get()
          inWorkerQueue = !workerCheck.empty
        }

        if (!inWorkerQueue) {
          await doc.ref.update({
            status: 'pending',
            recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
            recoveryReason: distributedAt ? 'stuck_distributed_timeout' : 'missing_distributedAt',
            ...(workerQueue ? { previousWorkerQueue: workerQueue } : {}),
            workerQueue: admin.firestore.FieldValue.delete(),
            distributedAt: admin.firestore.FieldValue.delete(),
            lockedAt: admin.firestore.FieldValue.delete(),
            lockedBy: admin.firestore.FieldValue.delete(),
          })
          recovered++
          console.log(`🔄 Recovered stuck email: ${data.email}`)
        }
      }
    }

    return { recovered, skippedLocked }
  } catch (err) {
    console.error('❌ Recovery fallback crashed:', err.message)
    return { recovered: 0, error: err.message }
  }
}

// 10. ORPHANED EMAIL RECOVERY — Runs frequently to catch stuck emails
exports.emailRecoveryWorker = onSchedule(
  {
    schedule: 'every 2 minutes',
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    const result1 = await recoverOrphanedEmails()
    const result2 = await recoverStuckDistributed()

    console.log('📊 Recovery summary:', {
      orphanedRecovered: result1.recovered || 0,
      stuckRecovered: result2.recovered || 0,
    })
  },
)

// 11. EMERGENCY RECOVERY — Runs less frequently but checks ALL distributed emails
exports.emailEmergencyRecovery = onSchedule(
  {
    schedule: 'every 15 minutes',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    console.log('🚨 Emergency Recovery: Deep scan starting...')

    try {
      let lastDoc = null
      let totalRecovered = 0
      let totalChecked = 0
      const batchSize = 500

      while (true) {
        let query = db
          .collection('emailQueue')
          .where('status', '==', 'distributed')
          .limit(batchSize)

        if (lastDoc) {
          query = query.startAfter(lastDoc)
        }

        const snapshot = await query.get()
        if (snapshot.empty) break

        const batch = db.batch()
        let batchRecovered = 0

        for (const doc of snapshot.docs) {
          const data = doc.data()

          // Skip recently locked emails
          if (data.lockedAt) {
            const lockedAt = data.lockedAt.toDate ? data.lockedAt.toDate() : new Date(data.lockedAt)
            const minutesSinceLock = (Date.now() - lockedAt.getTime()) / (60 * 1000)
            if (minutesSinceLock < CONFIG.LOCK_TIMEOUT_MINUTES) {
              totalChecked++
              continue
            }
          }

          const workerQueue = data.workerQueue
          let inWorkerQueue = false

          if (workerQueue) {
            const workerCheck = await db
              .collection(workerQueue)
              .where('originalDocId', '==', doc.id)
              .limit(1)
              .get()
            inWorkerQueue = !workerCheck.empty
          }

          if (!inWorkerQueue) {
            batch.update(doc.ref, {
              status: 'pending',
              recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
              recoveryReason: 'emergency_deep_scan',
              ...(workerQueue ? { previousWorkerQueue: workerQueue } : {}),
              workerQueue: admin.firestore.FieldValue.delete(),
              distributedAt: admin.firestore.FieldValue.delete(),
              lockedAt: admin.firestore.FieldValue.delete(),
              lockedBy: admin.firestore.FieldValue.delete(),
            })
            batchRecovered++
          }
          totalChecked++
        }

        if (batchRecovered > 0) {
          await batch.commit()
          totalRecovered += batchRecovered
          console.log(`🚨 Emergency: Recovered ${batchRecovered} in this batch`)
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1]
        if (snapshot.docs.length < batchSize) break
      }

      console.log(`🚨 Emergency Recovery complete: ${totalRecovered}/${totalChecked} recovered`)
    } catch (err) {
      console.error('❌ Emergency Recovery failed:', err.message)
    }
  },
)

// 12. GET MONTHLY SENDING STATS
exports.getMonthlyStats = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 10,
  },
  async (request) => {
    try {
      const now = new Date()
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

      const monthlyDocRef = db.collection('monthlyStats').doc(currentMonthKey)
      const monthlyDoc = await monthlyDocRef.get()

      let sent = 0
      if (monthlyDoc.exists) {
        sent = monthlyDoc.data().sent || 0
      }

      const limit = 78957 // monthly resend limit
      const remaining = Math.max(0, limit - sent)
      const percentage = Math.min(100, Math.round((sent / limit) * 100))

      return {
        currentMonth: currentMonthKey,
        sent,
        limit,
        remaining,
        percentage,
      }
    } catch (err) {
      console.error('❌ getMonthlyStats error:', err)
      throw new HttpsError('internal', err.message)
    }
  },
)

// =========================
// 10. GET CAMPAIGN EMAILS — Paginated fetch of all emails in a campaign
// =========================
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

      // Check if more exist
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

// =========================
// 11. EXPORT CAMPAIGN EMAILS — Returns ALL emails as bulk data
// =========================
exports.exportCampaignEmails = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 300,
    maxInstances: 5,
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
