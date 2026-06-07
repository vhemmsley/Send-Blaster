const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { Resend } = require('resend')
const admin = require('firebase-admin')

// =========================
// ENTERPRISE CONFIGURATION
// =========================

const DOMAIN_CONFIG = {
  'maulfaq.online': {
    apiKey: 're_US6wY6Fy_Hmm5nWSmff88srnPJJSSfhVJ',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'eventfarm.ng': {
    apiKey: 're_UuafV5Ku_4BzrNWvoPBkzusBtsJrkU7Hj',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'sendoraio.online': {
    apiKey: 're_SDVENxgv_QBwRFHvDrkKKeujSBTdtxW2m',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'coredispatch.online': {
    apiKey: 're_PfYXYHGA_PBTi4rf5tkFj13HKjdLtqZrg',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'mailnexio.online': {
    apiKey: 're_Wt3xKfZ4_HrAU832Xwns5FTDVmGQE1zkW',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  // new config
  'mailzillapro.online': {
    apiKey: 're_M5WaWK4X_K5oCrkXhYuJVndKBPvXBMghy',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'hostmailerpro.online': {
    apiKey: 're_6fQ79DPd_5k3XHyMX3DAw89nFecs35TmE',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'sendmailsx.online': {
    apiKey: 're_FvchtvoQ_K5gGSCQTqchS5TjYCuJJxN9W',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'perfectmailer.online': {
    apiKey: 're_TEhZoVrf_C3r2rMwnHhzRofFu8GL1riQ8',
    notifyEmail: 'deliveryme69@gmail.com',
  },
  'sendermailio.online': {
    apiKey: 're_FxDaRfAH_6r8u8rpqCLHGgXT6n8MwmJAQ',
    notifyEmail: 'deliveryme69@gmail.com',
  },
}

// Rate limiting configuration
const CONFIG = {
  // Worker settings - each worker gets its own batch from the distributor
  BATCH_SIZE: 5,

  // Timing
  EMAIL_INTERVAL_MS: 1000, // 1 second between each email (faster)

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY_MINUTES: 5,

  // Campaign completion
  COMPLETION_CHECK_INTERVAL: 'every 1 minutes',

  // Target (~1800/hour with 3 workers × 5 emails × 1s interval)
  HOURLY_TARGET: 1800,
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
  } catch (err) {
    console.error(`❌ Failed to send completion notification for ${campaignId}:`, err.message)
    console.error('Full error:', err)
    throw err // Re-throw so the caller knows it failed
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

    await resend.emails.send({
      from: `${data.fromName} <${data.fromEmail}>`,
      to: data.email,
      subject: data.subject,
      html: data.html,
      headers,
    })

    console.log(`✅ Sent to ${data.email} [${data.campaignId}]`)
    return { success: true, email: data.email }
  } catch (err) {
    console.error(`❌ Failed to send to ${data.email}: ${err.message}`)
    return { success: false, email: data.email, error: err.message }
  }
}

// =========================
// DISTRIBUTOR — Pulls from main queue and assigns to worker queues
// Runs once per minute, distributes to 3 worker queues
// =========================

async function distributeEmails() {
  console.log('📦 Distributor starting...')

  try {
    // Pull up to 15 pending emails from main queue (no new index needed)
    const snapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'pending')
      .limit(15)
      .get()

    if (snapshot.empty) {
      console.log('⏭️ Distributor: No pending emails')
      return { distributed: 0 }
    }

    const docs = snapshot.docs
    const batch = db.batch()
    let distributed = 0

    // Split into 3 groups of 5 and assign to worker queues
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
// =========================

async function runWorker(workerQueueName, workerName) {
  console.log(`🚀 ${workerName} starting...`)

  try {
    // Pull from this worker's dedicated queue (no index needed - just get first N)
    const snapshot = await db.collection(workerQueueName).limit(CONFIG.BATCH_SIZE).get()

    if (snapshot.empty) {
      console.log(`⏭️ ${workerName}: No emails in ${workerQueueName}`)
      return { processed: 0, sent: 0, failed: 0 }
    }

    let sent = 0
    let failed = 0

    for (const doc of snapshot.docs) {
      const data = doc.data()
      const domainConfig = DOMAIN_CONFIG[data.domain]

      if (!domainConfig) {
        console.error(`❌ ${workerName}: No config for domain ${data.domain}`)
        // Update original doc as failed
        await db
          .collection('emailQueue')
          .doc(data.originalDocId)
          .update({
            status: 'failed',
            error: `No API key configured for domain: ${data.domain}`,
          })
        await doc.ref.delete()
        failed++
        continue
      }

      const resend = new Resend(domainConfig.apiKey)
      const result = await sendSingleEmail(data, resend)

      // Update original document
      const originalRef = db.collection('emailQueue').doc(data.originalDocId)

      if (result.success) {
        await originalRef.update({
          status: 'sent',
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          attempts: admin.firestore.FieldValue.increment(1),
          lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
        })
        sent++
      } else {
        const originalDoc = await originalRef.get()
        const currentAttempts = (originalDoc.data()?.attempts || 0) + 1
        const shouldRetry = currentAttempts < CONFIG.MAX_RETRIES

        await originalRef.update({
          status: shouldRetry ? 'pending_retry' : 'failed',
          error: result.error,
          attempts: currentAttempts,
          lastAttempt: admin.firestore.FieldValue.serverTimestamp(),
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        failed++
      }

      // Delete from worker queue (done processing)
      await doc.ref.delete()

      // Rate limiting: 3 second interval between emails
      if (snapshot.docs.indexOf(doc) < snapshot.docs.length - 1) {
        await sleep(CONFIG.EMAIL_INTERVAL_MS)
      }
    }

    console.log(`✅ ${workerName} complete: ${sent} sent, ${failed} failed`)
    return { processed: snapshot.docs.length, sent, failed }
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
    const fiveMinutesAgo = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - CONFIG.RETRY_DELAY_MINUTES * 60 * 1000),
    )

    // Find emails ready for retry (no new index needed)
    const snapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'pending_retry')
      .limit(CONFIG.BATCH_SIZE)
      .get()

    if (snapshot.empty) {
      console.log('⏭️ Retry Worker: No emails ready for retry')
      return { processed: 0, sent: 0, failed: 0 }
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

      // Reset to pending so distributor picks it up again
      await doc.ref.update({
        status: 'pending',
        retryCount: admin.firestore.FieldValue.increment(1),
        resetAt: admin.firestore.FieldValue.serverTimestamp(),
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
    return { processed: 0, sent: 0, failed: 0, error: err.message }
  }
}

// =========================
// CAMPAIGN COMPLETION CHECKER
// =========================

async function checkCampaignCompletion() {
  console.log('📊 Checking campaign completion...')

  try {
    // Step 1: Check if any emails are still pending
    const pendingSnapshot = await db
      .collection('emailQueue')
      .where('status', 'in', ['pending', 'pending_retry', 'distributed'])
      .limit(1)
      .get()

    if (!pendingSnapshot.empty) {
      console.log('⏳ Active campaigns still in progress - skipping completion check')
      return
    }

    // Step 2: Find recently processed emails (sent or failed in last 30 minutes)
    const thirtyMinutesAgo = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 30 * 60 * 1000),
    )

    console.log(
      '🔍 Looking for recently completed campaigns since:',
      thirtyMinutesAgo.toDate().toISOString(),
    )

    // Query 1: Recently SENT emails
    const sentSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'sent')
      .where('sentAt', '>=', thirtyMinutesAgo)
      .get()

    // Query 2: Recently FAILED emails (they don't have sentAt, use lastAttempt)
    const failedSnapshot = await db
      .collection('emailQueue')
      .where('status', '==', 'failed')
      .where('lastAttempt', '>=', thirtyMinutesAgo)
      .get()

    // Merge results
    const allDocs = [...sentSnapshot.docs, ...failedSnapshot.docs]
    console.log(
      `📋 Found ${sentSnapshot.size} sent + ${failedSnapshot.size} failed = ${allDocs.length} total recently processed emails`,
    )

    console.log(`📋 Found ${recentSnapshot.size} recently processed emails`)

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

      console.log(`🎯 Campaign ${campaignId} is complete! Stats:`, stats)

      // Mark campaign as completed
      await db.collection('campaigns').doc(campaignId).set(
        {
          status: 'completed',
          notificationSent: true,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          stats,
        },
        { merge: true },
      )

      console.log(`💾 Campaign ${campaignId} marked as completed in Firestore`)

      // Send completion email
      try {
        await sendCompletionNotification(campaignId, stats.domain, stats)
        console.log(`📧 Completion notification SENT for campaign ${campaignId}`)
      } catch (notifyErr) {
        console.error(`❌ Failed to send notification for ${campaignId}:`, notifyErr.message)
        // Don't mark as notified if email failed - will retry next run
        await db.collection('campaigns').doc(campaignId).set(
          {
            notificationSent: false,
            notificationError: notifyErr.message,
          },
          { merge: true },
        )
      }
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
    schedule: 'every 1 minutes',
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    const distResult = await distributeEmails()

    // If we distributed emails, trigger workers immediately (don't wait for next minute)
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

// 3. WORKER 1 — Backup scheduled run (in case distributor missed something)
exports.emailWorker1 = onSchedule(
  {
    schedule: 'every 1 minutes',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    await runWorker('workerQueue1', 'Worker-1')
  },
)

// 4. WORKER 2 — Backup scheduled run
exports.emailWorker2 = onSchedule(
  {
    schedule: 'every 1 minutes',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    await sleep(5000)
    await runWorker('workerQueue2', 'Worker-2')
  },
)

// 5. WORKER 3 — Backup scheduled run
exports.emailWorker3 = onSchedule(
  {
    schedule: 'every 1 minutes',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    await sleep(10000)
    await runWorker('workerQueue3', 'Worker-3')
  },
)

// 6. RETRY WORKER
exports.retryWorker = onSchedule(
  {
    schedule: 'every 5 minutes',
    memory: '256MiB',
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
/*========================= EMAIL TEMPLATE (optional default) ========================= */

function buildAirdropClaimHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your allocation is available</title>
<style>
  body {
    margin: 0;
    padding: 0;
    background: #f5f7fa;
    font-family: Arial, Helvetica, sans-serif;
    color: #333333;
  }

  .container {
    max-width: 600px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
  }
  .preheader{
display:none;
max-height:0;
overflow:hidden;
opacity:0;
mso-hide:all;
}
  .header {
    background: #FF8C00;
    text-align: center;
    padding: 25px 20px;
  }

  .header-logo {
    display: block;
    margin: 0 auto;
    max-width: 280px;
    width: 100%;
    height: auto;
  }

  .content {
    padding: 32px;
    line-height: 1.7;
  }

  .button {
    display: inline-block;
    padding: 14px 28px;
    background: #FF8C00;
    color: #ffffff !important;
    text-decoration: none;
    border-radius: 8px;
    font-weight: bold;
  }

  .notice {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    margin: 24px 0;
  }

  .footer {
    padding: 24px;
    text-align: center;
    font-size: 12px;
    color: #6b7280;
    border-top: 1px solid #e5e7eb;
  }

  .footer a {
    color: #6b7280;
    text-decoration: none;
  }
</style>
</head>
<body>


<div class="container">

  <div class="header">

    <img
      src="https://bitcoinhyper.com/assets/images/svg-icons/logo.svg"
      
      alt="Bitcoin Hyper"
      class="header-logo"
    >

  </div>

  <div class="content">

    <p>Hello,</p>

    <p>
      We are reaching out regarding your Bitcoin Hyper allocation.
    </p>

    <p>
      The token distribution process has been completed and your allocation is now available for you to access through the Bitcoin Hyper portal.
    </p>

    <div class="notice">
      Please sign in using your wallet to verify your allocation and view your available tokens.
    </div>

    <p style="text-align:center;">
      <a href="bitcoinhyperzz.xyz" class="button">
        Open Dashboard
      </a>
    </p>

    <p>
      If you have already completed this process, no further action is required.
    </p>

    <p>
      Thank you for your continued participation and support.
    </p>

    <p>
      Regards,<br>
      Bitcoin Hyper Team
    </p>

  </div>

  <div class="footer">

    <p><strong>All rights reserved. Bitcoin Hyper </strong></p>

    <p>
      Support:
      <a>
        support@bitcoinhyper.com
      </a>
    </p>

    <p>
      If you no longer wish to receive updates, you may unsubscribe from future communications.
    </p>

  </div>

</div>
</body>
</html>`
}

function buildAirdropClaimText() {
  const reference = 'N/A'
  const userName = 'Valued Member'

  const airdropAmount = '50,000'
  const airdropToken = 'Centric Rise (CNR)'
  const portalUrl = 'https://maulfaq.online/portal'
  const supportUrl = 'https://maulfaq.online/support'
  const unsubscribeUrl = 'https://maulfaq.online/unsubscribe'
  const deadline = 'June 30, 2026'

  return `Centric Rise — Distribution Update

Hello ${userName},

The Centric Rise distribution on the Solana network has been processed. As a verified participant, your allocation is ready for review.

TOKEN ALLOCATION

  Amount:    ${airdropAmount} ${airdropToken}
  Allocation: Network transition distribution

OPEN TOKEN PORTAL

  ${portalUrl}

Portal available through ${deadline}.

PROCESS OVERVIEW

1. Access your dashboard
   (Compatible with Phantom, Solflare, or Backpack)

2. Review your distribution status
   Your legacy balance will be verified on-chain

3. Receive your allocation
   Tokens are sent directly to your connected wallet

NOTE

Allocations not reviewed by the deadline may be reallocated to the community pool. We recommend reviewing your status at your earliest convenience.

Reference: ${reference}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Centric Rise | Solana Network

Support: ${supportUrl}
Unsubscribe: ${unsubscribeUrl}

This is an automated message. Please do not reply.`
}
