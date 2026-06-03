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
          <!-- DOMAIN DROPDOWN -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Select Domain </label>

            <select
              v-model="selectedDomain"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option disabled value="">Select a domain</option>

              <option v-for="d in domains" :key="d.domain" :value="d">
                {{ d.domain }} ({{ d.fromEmail }})
              </option>
            </select>
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

          <!-- FROM NAME -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> From Name </label>

            <input
              v-model="fromName"
              type="text"
              placeholder="e.g. Little Pepe Team"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- EMAIL INPUT -->
          <div class="mb-4">
            <label class="text-sm font-medium text-slate-300 mb-2 block"> Email Addresses </label>

            <textarea
              v-model="emailInput"
              rows="10"
              placeholder="Paste emails here..."
              class="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none resize-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- STATS -->
          <div class="grid md:grid-cols-3 gap-4 mb-6">
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Total</p>
              <h2 class="text-2xl font-bold">{{ allEmails.length }}</h2>
            </div>

            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Valid</p>
              <h2 class="text-2xl font-bold text-green-400">{{ validEmails.length }}</h2>
            </div>

            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Invalid</p>
              <h2 class="text-2xl font-bold text-red-400">{{ invalidEmails.length }}</h2>
            </div>
          </div>

          <!-- BUTTON -->
          <button
            @click="submitEmails"
            :disabled="loading || !validEmails.length || !selectedDomain"
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

export default {
  data() {
    return {
      emailInput: '',
      subject: '',
      fromName: '',
      selectedDomain: '',
      loading: false,

      emailRegex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

      // 🔥 HARD CODED DOMAINS (NO FIRESTORE)
      domains: [
        {
          domain: 'maulfaq.online',
          apiKey: 're_xxx_1',
          fromEmail: 'team@maulfaq.online',
        },
        {
          domain: 'eventfarm.ng',
          apiKey: 're_xxx_2',
          fromEmail: 'team@eventfarm.ng',
        },
      ],
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

    invalidEmails() {
      return this.allEmails.filter((e) => !this.emailRegex.test(e))
    },
  },

  methods: {
    // 🔥 Sentence Case Formatter
    formatFrom(name) {
      return name
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    },

    async submitEmails() {
      this.loading = true

      try {
        const domainData = this.selectedDomain

        await sendBlaster({
          emails: this.validEmails,
          subject: this.subject,

          // 🔥 CORE CONFIG SENT TO FIRESTORE
          domain: domainData.domain,
          apiKey: domainData.apiKey,
          fromEmail: domainData.fromEmail,
          from: this.formatFrom(this.fromName),
        })

        alert(`Queued ${this.validEmails.length} emails successfully`)
      } catch (err) {
        console.error(err)
        alert(err.message)
      } finally {
        this.loading = false
      }
    },
  },
}
</script>
