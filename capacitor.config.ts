import type { CapacitorConfig } from '@capacitor/cli';

// The native shell loads the live Vercel deployment in a managed WebView so that
// SSR, middleware auth, and all API routes keep working unchanged. Override the
// target with CAP_SERVER_URL at build time for staging/preview builds.
const serverUrl = process.env.CAP_SERVER_URL ?? 'https://portal.seniorstylist.com';

const config: CapacitorConfig = {
  appId: 'com.seniorstylist.app',
  appName: 'Senior Stylist',
  webDir: 'public',
  server: {
    url: serverUrl,
    cleartext: false,
    // https keeps the WebView in a secure context so Supabase auth cookies
    // (Secure; SameSite=Lax) are honored exactly as they are in the browser.
    androidScheme: 'https',
    iosScheme: 'https',
  },
  backgroundColor: '#F7F6F2', // brand cream — matches manifest background_color
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#1C0A12', // dark burgundy — matches the app icon background
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT', // light text — the burgundy header sits behind the status bar
      backgroundColor: '#8B2E4A',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
