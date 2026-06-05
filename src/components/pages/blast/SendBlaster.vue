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
          <!-- Domain Select -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Select Domain </label>

            <select
              v-model="selectedDomain"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option disabled value="">Choose domain</option>

              <option v-for="d in domains" :key="d.domain" :value="d.domain">
                {{ d.domain }}
              </option>
            </select>
          </div>

          <!-- From Name (Subdomain) -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> From Name </label>

            <div
              class="flex bg-slate-950 border border-slate-700 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500"
            >
              <input
                v-model="fromName"
                type="text"
                placeholder="e.g. team"
                class="flex-1 bg-transparent px-4 py-3 outline-none"
              />

              <span class="flex items-center px-4 text-slate-500 text-sm border-l border-slate-700">
                @{{ selectedDomain || 'domain.com' }}
              </span>
            </div>

            <p class="text-xs text-slate-500 mt-1">
              Full sender: {{ formattedFromName }} &lt;{{ computedFromEmail }}&gt;
            </p>
          </div>

          <!-- Subject -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2"> Email Subject </label>

            <input
              v-model="subject"
              type="text"
              placeholder="Enter email subject..."
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- HTML Content -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-slate-300 mb-2">
              Email HTML Content
            </label>

            <textarea
              v-model="html"
              rows="10"
              placeholder="Paste your email HTML here..."
              class="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none resize-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
          </div>

          <!-- Emails -->
          <div class="mb-4">
            <div class="flex justify-between items-center mb-2">
              <label class="text-sm font-medium text-slate-300"> Email Addresses </label>

              <span class="text-sm text-blue-400"> {{ validEmails.length }} Valid Emails </span>
            </div>

            <textarea
              v-model="emailInput"
              rows="12"
              placeholder="Paste emails here...

john@gmail.com
sarah@yahoo.com
mike@hotmail.com

or

john@gmail.com, sarah@yahoo.com, mike@hotmail.com"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none resize-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- Validation -->
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-6">
            <div class="flex items-center justify-between mb-3">
              <span class="font-semibold"> Validation Summary </span>

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

          <!-- Stats -->
          <div class="grid md:grid-cols-3 gap-4 mb-8">
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Total Entries</p>

              <h2 class="text-2xl font-bold mt-1">
                {{ totalEmails }}
              </h2>
            </div>

            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Valid Emails</p>

              <h2 class="text-2xl font-bold text-green-400 mt-1">
                {{ validEmails.length }}
              </h2>
            </div>

            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <p class="text-slate-400 text-sm">Invalid Emails</p>

              <h2 class="text-2xl font-bold text-red-400 mt-1">
                {{ invalidEmails.length }}
              </h2>
            </div>
          </div>

          <!-- Button -->
          <button
            @click="submitEmails"
            :disabled="
              loading || !validEmails.length || !selectedDomain || !fromName || !subject || !html
            "
            class="w-full py-4 rounded-xl font-semibold transition-all duration-300 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed"
          >
            <span v-if="!loading"> Send Emails</span>

            <span v-else> Processing... </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { sendBlaster } from '@/firebase/firebase'

export default {
  data() {
    return {
      emailInput: '',
      subject: '',
      fromName: '',
      html: '',
      selectedDomain: '',
      loading: false,
      emailRegex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      me: 'no',
      domains: [
        {
          domain: 'maulfaq.online',
          apiKey: 're_ECbt48yn_HvogtYFGCbgWcu4n8yN3RvMg',
        },
        {
          domain: 'eventfarm.ng',
          apiKey: 're_UuafV5Ku_4BzrNWvoPBkzusBtsJrkU7Hj',
        },
        {
          domain: 'sendoraio.online',
          apiKey: 're_SDVENxgv_QBwRFHvDrkKKeujSBTdtxW2m',
        },
        {
          domain: 'coredispatch.online',
          apiKey: 're_PfYXYHGA_PBTi4rf5tkFj13HKjdLtqZrg',
        },
        {
          domain: 'mailnexio.online',
          apiKey: 're_Wt3xKfZ4_HrAU832Xwns5FTDVmGQE1zkW',
        },
      ],
    }
  },

  computed: {
    selectedDomainObj() {
      return this.domains.find((d) => d.domain === this.selectedDomain)
    },

    computedFromEmail() {
      if (!this.fromName || !this.selectedDomain) return ''
      const clean = this.fromName.trim().toLowerCase().replace(/\s+/g, '')
      return `${clean}@${this.selectedDomain}`
    },

    formattedFromName() {
      if (!this.fromName) return ''
      return this.toSentenceCase(this.fromName)
    },

    allEmails() {
      return this.emailInput
        .split(/[\n,\s]+/)
        .map((email) => email.trim())
        .filter((email) => email)
    },

    validEmails() {
      return this.allEmails.filter((email) => this.emailRegex.test(email))
    },

    invalidEmails() {
      return this.allEmails.filter((email) => !this.emailRegex.test(email))
    },

    totalEmails() {
      return this.allEmails.length
    },
  },

  methods: {
    toSentenceCase(str) {
      if (!str) return ''
      return str
        .toLowerCase()
        .split(' ')
        .filter((word) => word)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    },

    async submitEmails() {
      this.loading = true

      try {
        const d = this.selectedDomainObj

        if (!d) {
          throw new Error('Please select a domain')
        }

        const payload = {
          emails: this.validEmails,
          subject: this.toSentenceCase(this.subject),
          html: this.html,
          fromName: this.formattedFromName,
          fromEmail: this.computedFromEmail,
          domain: d.domain,
          apiKey: d.apiKey,
        }

        console.log('PAYLOAD TO BACKEND:', payload)

        const result = await sendBlaster(payload)

        console.log('FULL RESULT:', result)
        console.log('DATA:', result.data)

        alert(`Server received ${this.validEmails.length} emails`)
      } catch (error) {
        console.error(error)
        alert(error.message)
      } finally {
        this.loading = false
      }
    },
  },
}
</script>
