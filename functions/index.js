const { onCall } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { Resend } = require('resend')

const resendApiKey = defineSecret('RESEND_API_KEY')

exports.sendBlaster = onCall(
  {
    secrets: [resendApiKey],
  },
  async (request) => {
    const resend = new Resend(resendApiKey.value())

    const { emails, subject } = request.data

    console.log('Emails received:', emails)

    const email = emails?.[0]

    try {
      const response = await resend.emails.send({
        from: 'test <team@maulfaq.online>',
        to: email,
        subject: subject || 'Test Email',
        html: '<h1>Test quest/h1>',
      })

      console.log('Resend response:', response)

      return {
        success: true,
        debug: response,
        sentTo: email,
      }
    } catch (err) {
      console.error('Resend error:', err)

      return {
        success: false,
        error: err.message,
      }
    }
  },
)
