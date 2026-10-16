import { SetMetadata } from '@nestjs/common';

export const PROPERTY_PERMISSIONS = [
  'view_dashboard',
  'view_bookings',
  'check_in_out',
  'manage_rooms',
  'view_availability',
  'view_analytics',
  'manage_reviews',
  'manage_disputes',
  'manage_settings',
  'manage_staff',
] as const;
export type HotelPermission = (typeof PROPERTY_PERMISSIONS)[number];
export const PROPERTY_PERMISSION_KEY = 'propertyPermission';
export const APPLICATION_ACCESS_KEY = 'propertyApplicationAccess';
export const PropertyPermission = (permission: HotelPermission | HotelPermission[]) =>
  SetMetadata(PROPERTY_PERMISSION_KEY, permission);
export const ApplicationAccess = () => SetMetadata(APPLICATION_ACCESS_KEY, true);

export const DEFAULT_PROPERTY_PERMISSIONS: Record<string, readonly HotelPermission[]> = {
  OWNER: PROPERTY_PERMISSIONS,
  HOTEL_ADMIN: PROPERTY_PERMISSIONS.filter((p) => p !== 'manage_staff'),
  MANAGER: [
    'view_dashboard',
    'view_bookings',
    'check_in_out',
    'manage_rooms',
    'view_availability',
    'manage_reviews',
    'manage_disputes',
  ],
  STAFF: ['view_bookings', 'check_in_out', 'view_availability'],
};
