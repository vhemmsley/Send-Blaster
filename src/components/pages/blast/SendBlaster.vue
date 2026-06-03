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
          <!-- DOMAIN SELECT -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Select Domain </label>

            <select
              v-model="selectedDomain"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option disabled value="">Choose domain</option>

              <option v-for="d in domains" :key="d.domain" :value="d.domain">
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
              placeholder="e.g. little pepe team"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- EMAIL INPUT -->
          <div class="mb-4">
            <div class="flex justify-between items-center mb-2">
              <label class="text-sm font-medium text-slate-300"> Email Addresses </label>

              <span class="text-sm text-blue-400"> {{ validEmails.length }} Valid Emails </span>
            </div>

            <textarea
              v-model="emailInput"
              rows="12"
              placeholder="Paste emails here..."
              class="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none resize-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- VALIDATION -->
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-6">
            <div class="flex items-center justify-between mb-3">
              <span class="font-semibold">Validation Summary</span>

              <span class="text-sm px-3 py-1 rounded-full bg-blue-500/20 text-blue-400">
                {{ validEmails.length }} Valid
              </span>
            </div>

            <div v-if="invalidEmails.length">
              <h3 class="text-red-400 text-sm mb-2">Invalid Emails</h3>

              <div class="flex flex-wrap gap-2">
                <span
                  v-for="email in invalidEmails"
                  :key="email"
                  class="bg-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs"
                >
                  {{ email }}
                </span>
              </div>
            </div>

            <div v-else class="text-green-400 text-sm">No invalid emails detected.</div>
          </div>

          <!-- STATS -->
          <div class="grid md:grid-cols-3 gap-4 mb-8">
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Total</p>
              <h2 class="text-2xl font-bold">{{ totalEmails }}</h2>
            </div>

            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Valid</p>
              <h2 class="text-2xl font-bold text-green-400">
                {{ validEmails.length }}
              </h2>
            </div>

            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Invalid</p>
              <h2 class="text-2xl font-bold text-red-400">
                {{ invalidEmails.length }}
              </h2>
            </div>
          </div>

          <!-- BUTTON -->
          <button
            @click="submitEmails"
            :disabled="loading || !validEmails.length || !selectedDomain"
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
import { sendBlasterFn } from '@/firebase/firebase'

export default {
  data() {
    return {
      emailInput: '',
      subject: '',
      fromName: '',
      selectedDomain: '',
      loading: false,

      emailRegex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

      domains: [
        {
          domain: 'maulfaq.online',
          apiKey: 're_ECbt48yn_HvogtYFGCbgWcu4n8yN3RvMg',
          fromEmail: 'team@maulfaq.online',
        },
        {
          domain: 'eventfarm.ng',
          apiKey: 're_UuafV5Ku_4BzrNWvoPBkzusBtsJrkU7Hj',
          fromEmail: 'team@eventfarm.ng',
        },
      ],
    }
  },

  computed: {
    selectedDomainObj() {
      return this.domains.find((d) => d.domain === this.selectedDomain)
    },

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

    totalEmails() {
      return this.allEmails.length
    },
  },

  methods: {
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
        const d = this.selectedDomainObj

        if (!d) {
          throw new Error('Please select a domain')
        }

        await sendBlasterFn({
          emails: this.validEmails,
          subject: this.subject,

          domain: d.domain,
          apiKey: d.apiKey,
          fromEmail: d.fromEmail,

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
