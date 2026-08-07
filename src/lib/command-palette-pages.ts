export interface PaletteRoute {
  id: string
  label: string
  description: string
  route: string
  icon: string
  roles: string[]
  /** P51 — also shown when the caller is manage-tier (franchise admin /
   * bookkeeper / master), regardless of the roles list. */
  manageTier?: boolean
}

export const PALETTE_ROUTES: PaletteRoute[] = [
  // P47 — stylist rows match the sidebar nav (Calendar / Daily Log / My Account).
  { id: 'dashboard', label: 'Calendar', description: 'View and manage appointments', route: '/dashboard', icon: 'Calendar', roles: ['admin', 'facility_staff', 'bookkeeper', 'stylist'] },
  { id: 'residents', label: 'Residents', description: 'Manage resident profiles', route: '/residents', icon: 'Users', roles: ['admin', 'facility_staff'] },
  { id: 'daily-log', label: 'Daily Log', description: 'View and edit the daily log', route: '/log', icon: 'FileText', roles: ['admin', 'facility_staff', 'bookkeeper', 'stylist'] },
  { id: 'my-account', label: 'My Account', description: 'Your schedule, earnings, and documents', route: '/my-account', icon: 'Wallet', roles: ['stylist'] },
  { id: 'stylists', label: 'Stylists', description: 'Stylist roster', route: '/stylists', icon: 'Scissors', roles: ['admin', 'bookkeeper'] },
  { id: 'billing', label: 'Billing', description: 'Invoices, payments, and statements', route: '/billing', icon: 'CreditCard', roles: ['admin', 'bookkeeper'] },
  { id: 'analytics', label: 'Analytics', description: 'Revenue and performance reports', route: '/analytics', icon: 'BarChart3', roles: ['admin', 'bookkeeper'] },
  { id: 'payroll', label: 'Payroll', description: 'Pay periods and stylist payroll', route: '/payroll', icon: 'Wallet', roles: ['bookkeeper'], manageTier: true }, // P51 — facility admin loses payroll; franchise keeps it via manageTier
  { id: 'settings', label: 'Settings', description: 'Facility settings and integrations', route: '/settings', icon: 'Settings', roles: ['admin', 'bookkeeper'] },
  { id: 'master-admin', label: 'Master Admin', description: 'Platform-wide management', route: '/master-admin', icon: 'Shield', roles: [] },
  { id: 'stylists-directory', label: 'Stylist Directory', description: 'Full stylist workforce roster', route: '/stylists/directory', icon: 'BookOpen', roles: [], manageTier: true },
]
