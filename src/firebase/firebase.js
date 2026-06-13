import { initializeApp } from 'firebase/app'
import { getFunctions, httpsCallable } from 'firebase/functions'

const firebaseConfig = {
  apiKey: 'AIzaSyAi8gO38qbrP81Fg9roUuiOGAp_yrCyWho',
  authDomain: 'send-blaster.firebaseapp.com',
  projectId: 'send-blaster',
  storageBucket: 'send-blaster.firebasestorage.app',
  messagingSenderId: '761673475878',
  appId: '1:761673475878:web:e3dc8fce17ed26028f83e7',
}

// IMPORTANT: export functions object too for debugging
const app = initializeApp(firebaseConfig)
const functions = getFunctions(app, 'us-central1')

export const sendBlaster = httpsCallable(functions, 'sendBlaster')
export const getCampaignStatus = httpsCallable(functions, 'getCampaignStatus')
export const getCampaigns = httpsCallable(functions, 'getCampaigns')
export const getMonthlyStats = httpsCallable(functions, 'getMonthlyStats')
