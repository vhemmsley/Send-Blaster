<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
    <div class="container mx-auto px-4 py-10">
      <!-- Header -->
      <div class="max-w-4xl mx-auto text-center mb-10">
        <h1 class="text-5xl font-bold mb-4">Send Blaster</h1>
        <p class="text-slate-400 text-lg">
          Paste multiple email addresses and blast your campaign with ease.
        </p>
      </div>

      <div class="max-w-4xl mx-auto">
        <div
          class="bg-slate-900/70 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl"
        >
          <!-- DOMAIN SELECT 🔥 NEW -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Select Domain </label>

            <select
              v-model="domain"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option disabled value="">Select a domain</option>
              <option v-for="d in domains" :key="d" :value="d">
                {{ d }}
              </option>
            </select>
          </div>

          <!-- FROM INPUT 🔥 NEW -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> From Name </label>

            <input
              v-model="from"
              type="text"
              placeholder="e.g. Little Pepe Team"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- SUBJECT -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Email Subject </label>

            <input
              v-model="subject"
              type="text"
              placeholder="Enter email subject..."
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- EMAILS -->
          <div class="mb-4">
            <label class="text-sm font-medium text-slate-300 mb-2 block"> Email Addresses </label>

            <textarea
              v-model="emailInput"
              rows="12"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none resize-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- BUTTON -->
          <button
            @click="submitEmails"
            :disabled="loading || !validEmails.length || !domain"
            class="w-full py-4 rounded-xl font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700"
          >
            {{ loading ? 'Processing...' : 'Send Emails' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { sendBlaster } from '@/firebase'
import { getFirestore, collection, getDocs } from 'firebase/firestore'

const db = getFirestore()

export default {
  data() {
    return {
      emailInput: '',
      subject: '',
      from: '',
      domain: '',
      domains: [],
      loading: false,
      emailRegex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    }
  },

  computed: {
    allEmails() {
      return this.emailInput
        .split(/[\n,\s]+/)
        .map((e) => e.trim())
        .filter(Boolean)
    },

    validEmails() {
      return this.allEmails.filter((e) => this.emailRegex.test(e))
    },
  },

  async mounted() {
    await this.fetchDomains()
  },

  methods: {
    // 🔥 FETCH DOMAINS FROM FIRESTORE
    async fetchDomains() {
      try {
        const snap = await getDocs(collection(db, 'apis'))

        this.domains = snap.docs.map((doc) => doc.id)
      } catch (err) {
        console.error('Failed to load domains:', err)
      }
    },

    // 🔥 FORMAT FROM NAME (Sentence Case)
    formatFrom(name) {
      return name
        .toLowerCase()
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    },

    async submitEmails() {
      this.loading = true

      try {
        await sendBlaster({
          emails: this.validEmails,
          subject: this.subject,
          domain: this.domain,
          from: this.formatFrom(this.from),
        })

        alert(`Queued ${this.validEmails.length} emails`)
      } catch (err) {
        alert(err.message)
      } finally {
        this.loading = false
      }
    },
  },
}
</script>
