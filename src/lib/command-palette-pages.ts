export interface PaletteRoute {
  id: string
  label: string
  description: string
  route: string
  icon: string
  roles: string[]
}

export const PALETTE_ROUTES: PaletteRoute[] = [
  { id: 'dashboard', label: 'Calendar', description: 'View and manage appointments', route: '/dashboard', icon: 'Calendar', roles: ['admin', 'facility_staff', 'bookkeeper'] },
  { id: 'residents', label: 'Residents', description: 'Manage resident profiles', route: '/residents', icon: 'Users', roles: ['admin', 'facility_staff'] },
  { id: 'daily-log', label: 'Daily Log', description: 'View and edit the daily log', route: '/log', icon: 'FileText', roles: ['admin', 'facility_staff', 'bookkeeper'] },
  { id: 'stylists', label: 'Stylists', description: 'Manage stylists', route: '/stylists', icon: 'Scissors', roles: ['admin'] },
  { id: 'billing', label: 'Billing', description: 'Invoices, payments, and statements', route: '/billing', icon: 'CreditCard', roles: ['admin', 'bookkeeper'] },
  { id: 'analytics', label: 'Analytics', description: 'Revenue and performance reports', route: '/analytics', icon: 'BarChart3', roles: ['admin', 'bookkeeper'] },
  { id: 'payroll', label: 'Payroll', description: 'Pay periods and stylist payroll', route: '/payroll', icon: 'Wallet', roles: ['admin', 'bookkeeper'] },
  { id: 'settings', label: 'Settings', description: 'Facility settings and integrations', route: '/settings', icon: 'Settings', roles: ['admin', 'bookkeeper'] },
  { id: 'master-admin', label: 'Master Admin', description: 'Platform-wide management', route: '/master-admin', icon: 'Shield', roles: [] },
  { id: 'stylists-directory', label: 'Stylist Directory', description: 'Full stylist workforce roster', route: '/stylists/directory', icon: 'BookOpen', roles: [] },
]
