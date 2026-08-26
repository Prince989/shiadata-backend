export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  countryCode: string;
  locale: string;
  counselingConsent: boolean;
}

export interface RefreshRecord {
  id: string;
  userId: string;
  tokenHash: string;
  replacedBy?: string;
  revoked: boolean;
}
