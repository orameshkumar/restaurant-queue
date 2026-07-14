// Authoritative role definitions — import from here, never inline.

// Full management access: admin panel, all tables, remove items, etc.
export const MANAGER_ROLES = ['admin', 'manager']

// Kitchen management access: all KDS actions (release, bump, not-available)
// kitchen_manager operates within the kitchen but not the restaurant admin panel
export const KITCHEN_MANAGER_ROLES = ['admin', 'manager', 'kitchen_manager']

// Helper — use in components that receive a profile object
export const isManagerRole         = (profile) => MANAGER_ROLES.includes(profile?.role)
export const isKitchenManagerRole  = (profile) => KITCHEN_MANAGER_ROLES.includes(profile?.role)
