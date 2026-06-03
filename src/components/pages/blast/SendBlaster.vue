<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
    <div class="container mx-auto px-4 py-10">
      <!-- HEADER -->
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
          <!-- DOMAIN SELECT (FIXED) -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Select Domain </label>

            <select
              v-model="selectedDomain"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option disabled value="">-- Choose domain --</option>
              <option v-for="domain in domains" :key="domain" :value="domain">
                {{ domain }}
              </option>
            </select>
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
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Email Addresses </label>

            <textarea
              v-model="emailInput"
              rows="10"
              placeholder="Paste emails..."
              class="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- BUTTON -->
          <button
            @click="submitEmails"
            :disabled="loading || !validEmails.length || !selectedDomain || !fromName"
            class="w-full py-4 rounded-xl font-semibold transition-all duration-300 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed"
          >
            <span v-if="!loading">Send Emails</span>
            <span v-else>Processing...</span>
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
      selectedDomain: 'maulfaq.online', // ✅ FIX: default selected so dropdown NEVER looks empty
      loading: false,

      domains: ['maulfaq.online', 'eventfarm.ng'],

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

  methods: {
    // ✅ sentence case formatter
    toSentenceCase(str) {
      if (!str) return ''
      return str
        .toLowerCase()
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    },

    async submitEmails() {
      this.loading = true

      try {
        const result = await sendBlaster({
          emails: this.validEmails,
          subject: this.toSentenceCase(this.subject),
          from: this.toSentenceCase(this.fromName),
          domain: this.selectedDomain,
        })

        console.log(result)

        alert(`Queued ${this.validEmails.length} emails for ${this.selectedDomain}`)
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
