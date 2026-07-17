const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// URL complète d'un fichier servi par le backend (ex. avatarUrl `/uploads/avatars/...`).
// Une URL déjà absolue (http/https) est renvoyée telle quelle — rétro-compat des logos
// partenaires saisis en URL externe avant le passage à l'upload de fichier.
export function assetUrl(path: string | null): string | null {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `${BASE_URL}${path}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || `HTTP ${res.status}`);
    if (body && typeof body.subject === 'string') (err as Error & { subject?: string }).subject = body.subject;
    if (body && typeof body.count === 'number') (err as Error & { count?: number }).count = body.count;
    throw err;
  }

  return res.json() as Promise<T>;
}

export const api = {
  // --- Public ---
  getSports: () => request<Sport[]>('/api/sports'),

  listClubs: (filters: { sport?: string; city?: string; q?: string; region?: string; lat?: number; lng?: number } = {}) => {
    const qs = new URLSearchParams();
    if (filters.sport)  qs.set('sport', filters.sport);
    if (filters.city)   qs.set('city', filters.city);
    if (filters.q)      qs.set('q', filters.q);
    if (filters.region) qs.set('region', filters.region);
    if (typeof filters.lat === 'number' && typeof filters.lng === 'number') {
      qs.set('lat', String(filters.lat));
      qs.set('lng', String(filters.lng));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<ClubSummary[]>(`/api/clubs${suffix}`);
  },

  getClub: (slug: string) => request<ClubDetail>(`/api/clubs/${slug}`),

  listNationalTournaments: () => request<NationalTournament[]>('/api/tournaments/national'),

  /** Vitrine palova.fr : parties ouvertes publiques agrégées tous clubs (7 jours, jamais pleines). */
  listNationalOpenMatches: () => request<NationalOpenMatch[]>('/api/open-matches/national'),

  /** Résout un libellé de sous-domaine (slug actuel ou alias historique). 404 si inconnu. */
  resolveClubSlug: (slug: string) =>
    request<{ slug: string; moved: boolean }>(`/api/clubs/_resolve/${slug}`),

  getResource: (resourceId: string) => request<PublicResource>(`/api/resources/${resourceId}`),

  getAvailability: (resourceId: string, date: string, duration: number) =>
    request<TimeSlot[]>(`/api/resources/${resourceId}/availability?date=${date}&duration=${duration}`),

  getClubAvailability: (slug: string, date: string, duration: number, clubSportId?: string) =>
    request<ClubAvailability[]>(`/api/clubs/${slug}/availability?date=${date}&duration=${duration}${clubSportId ? `&clubSportId=${clubSportId}` : ''}`),

  // --- Compte ---
  // L'inscription ne renvoie plus de token : elle déclenche l'envoi d'un code par email.
  register: (body: RegisterBody) =>
    request<RegisterPending>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  verifyEmail: (email: string, code: string) =>
    request<AuthResponse>('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) }),

  resendCode: (email: string) =>
    request<{ ok: boolean; devCode?: string }>('/api/auth/resend-code', { method: 'POST', body: JSON.stringify({ email }) }),

  // Mot de passe oublié : demande un code (réponse neutre), puis réinitialise.
  forgotPassword: (email: string) =>
    request<{ ok: boolean; devCode?: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

  resetPassword: (email: string, code: string, newPassword: string) =>
    request<AuthResponse>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) }),

  // Changement de mot de passe par l'utilisateur connecté (fournit l'ancien).
  changePassword: (currentPassword: string, newPassword: string, token: string) =>
    request<{ ok: boolean }>('/api/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }, token),

  // Suppression de compte (anonymisation) — résumé des blocages/avertissements puis suppression.
  getAccountDeletionSummary: (token: string) =>
    request<AccountDeletionSummary>('/api/me/account-deletion-summary', {}, token),
  deleteMyAccount: (password: string, token: string) =>
    request<{ ok: boolean }>('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) }, token),

  getMyClubs: (token: string) => request<ManagedClub[]>('/api/me/clubs', {}, token),

  getMyReservations: (token: string) => request<MyReservation[]>('/api/me/reservations', {}, token),

  // --- Notifications (Lot 1) ---
  getNotifications: (token: string, cursor?: string) =>
    request<NotificationPage>(`/api/me/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {}, token),
  getUnreadCount: (token: string) =>
    request<{ count: number }>('/api/me/notifications/unread-count', {}, token),
  markNotificationRead: (id: string, token: string) =>
    request<{ ok: boolean }>(`/api/me/notifications/${id}/read`, { method: 'POST' }, token),
  markAllNotificationsRead: (token: string) =>
    request<{ ok: boolean }>('/api/me/notifications/read-all', { method: 'POST' }, token),
  getNotificationPreferences: (token: string) =>
    request<{ preferences: NotifPrefRow[] }>('/api/me/notification-preferences', {}, token),
  updateNotificationPreferences: (preferences: NotifPrefRow[], token: string) =>
    request<{ ok: boolean }>('/api/me/notification-preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }, token),

  // --- Résultats de matchs (Lot 2) ---
  recordMatchResult: (reservationId: string, body: { teams: Record<1 | 2, string[]>; sets: [number, number][]; competitive?: boolean }, token: string) =>
    request<{ id: string; status: string }>(`/api/reservations/${reservationId}/match`, { method: 'POST', body: JSON.stringify(body) }, token),
  getMyMatches: (token: string) => request<MyMatch[]>('/api/me/matches', {}, token),
  getMatchesToRecord: (token: string) => request<MatchToRecord[]>('/api/me/matches/to-record', {}, token),
  confirmMatch: (matchId: string, token: string) =>
    request<{ ok: true }>(`/api/matches/${matchId}/confirm`, { method: 'POST' }, token),
  disputeMatch: (matchId: string, message: string, token: string) =>
    request<{ ok: true }>(`/api/matches/${matchId}/dispute`, { method: 'POST', body: JSON.stringify({ message }) }, token),
  getMatchComments: (matchId: string, token: string) =>
    request<MatchThread>(`/api/matches/${matchId}/comments`, {}, token),
  postMatchComment: (matchId: string, body: string, token: string) =>
    request<{ ok: true }>(`/api/matches/${matchId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  getClubMatches: (clubId: string, status: string, token: string) =>
    request<ClubMatch[]>(`/api/clubs/${clubId}/admin/matches?status=${encodeURIComponent(status)}`, {}, token),
  resolveClubMatch: (clubId: string, matchId: string, body: { action: 'VALIDATE' | 'CANCEL'; sets?: [number, number][] }, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/matches/${matchId}/resolve`, { method: 'POST', body: JSON.stringify(body) }, token),
  voidClubMatch: (clubId: string, matchId: string, body: { reason: string }, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/matches/${matchId}/void`, { method: 'POST', body: JSON.stringify(body) }, token),

  // Adhésions du joueur (clubs dont il est membre + statut abonné).
  getMyMemberships: (token: string) => request<PlayerMembership[]>('/api/me/memberships', {}, token),

  // Auto-inscription du joueur connecté à un club (adhésion automatique, idempotente).
  joinClub: (slug: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${slug}/join`, { method: 'POST' }, token),

  createClub: (body: CreateClubBody, token: string) =>
    request<ClubAdminDetail>('/api/clubs', { method: 'POST', body: JSON.stringify(body) }, token),

  // --- Réservation joueur ---
  holdSlot: (params: HoldParams, token: string) =>
    request<Reservation>('/api/reservations/hold', { method: 'POST', body: JSON.stringify(params) }, token),

  confirmReservation: (
    reservationId: string,
    token: string,
    options?: {
      paymentSource?: { packageId: string } | { subscriptionId: string };
      stripePaymentIntentId?: string;
      stripeSetupIntentId?: string;
      cgvAccepted?: boolean;
    },
  ) =>
    request<Reservation>(`/api/reservations/${reservationId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }, token),

  applyHoldSetup: (
    reservationId: string,
    token: string,
    setup: {
      partnerUserIds?: string[];
      visibility?: 'PRIVATE' | 'PUBLIC';
      targetLevelMin?: number | null;
      targetLevelMax?: number | null;
      teams?: Record<string, 1 | 2>;
      slots?: Record<string, number>;
      competitive?: boolean;
    },
  ) =>
    request<Reservation>(`/api/reservations/${reservationId}/setup`, {
      method: 'POST',
      body: JSON.stringify(setup),
    }, token),

  // --- Stripe Connect (admin) ---
  initiateStripeConnect: (clubId: string, body: { refreshUrl: string; returnUrl: string }, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/stripe/connect`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  getStripeStatus: (clubId: string, token: string) =>
    request<{ stripeAccountStatus: string }>(`/api/clubs/${clubId}/admin/stripe/status`, {}, token),

  getStripeLoginLink: (clubId: string, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/stripe/login-link`, {}, token),

  disconnectStripe: (clubId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/stripe/disconnect`, { method: 'POST' }, token),

  // --- Stripe Intent (joueur) ---
  createStripeIntent: (
    slug: string,
    body: { reservationId: string; type: 'payment' | 'setup'; payShare?: boolean },
    token: string,
  ) =>
    request<{ clientSecret: string; type: 'payment' | 'setup'; stripeAccountId: string | null; customerSessionClientSecret: string | null }>(
      `/api/clubs/${slug}/stripe/intent`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  /** Crée un PaymentIntent ou SetupIntent pour une inscription payante. */
  createRegistrationIntent: (
    kind: 'tournaments' | 'events',
    eventId: string,
    regId: string,
    token: string,
  ) =>
    request<{ clientSecret: string; type: 'payment' | 'setup'; stripeAccountId: string | null; customerSessionClientSecret: string | null }>(
      `/api/${kind}/${eventId}/registrations/${regId}/intent`,
      { method: 'POST' },
      token,
    ),

  /** Confirme côté serveur le paiement d'une inscription (après webhook Stripe). */
  confirmRegistrationPayment: (
    kind: 'tournaments' | 'events',
    eventId: string,
    regId: string,
    stripePaymentIntentId: string,
    token: string,
  ) =>
    request(
      `/api/${kind}/${eventId}/registrations/${regId}/confirm-payment`,
      { method: 'POST', body: JSON.stringify({ stripePaymentIntentId }) },
      token,
    ),

  // --- No-show (admin) ---
  chargeNoShow: (
    clubId: string,
    reservationId: string,
    body: { amount: number; note?: string },
    token: string,
  ) =>
    request<{ paymentId: string; stripePaymentIntentId: string }>(
      `/api/clubs/${clubId}/admin/reservations/${reservationId}/no-show-charge`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  cancelReservation: (reservationId: string, token: string) =>
    request<Reservation>(`/api/reservations/${reservationId}`, { method: 'DELETE' }, token),

  getReservationPlayers: (reservationId: string, token: string) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/players`, {}, token),
  addReservationPlayer: (reservationId: string, memberUserId: string, token: string) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/players`, { method: 'POST', body: JSON.stringify({ memberUserId }) }, token),
  removeReservationPlayer: (reservationId: string, participantId: string, token: string) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/players/${participantId}`, { method: 'DELETE' }, token),
  setReservationTeams: (reservationId: string, teams: Record<string, 1 | 2>, token: string, slots?: Record<string, number>) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/teams`, { method: 'POST', body: JSON.stringify({ teams, slots }) }, token),
  setReservationVisibility: (
    reservationId: string,
    visibility: 'PRIVATE' | 'PUBLIC',
    token: string,
    opts?: { targetLevelMin?: number | null; targetLevelMax?: number | null; competitive?: boolean },
  ) =>
    request<{ id: string; visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin: number | null; targetLevelMax: number | null; competitive: boolean }>(
      `/api/reservations/${reservationId}/visibility`,
      { method: 'POST', body: JSON.stringify({ visibility, ...opts }) },
      token,
    ),

  // --- Parties ouvertes (visibles de tous ; token facultatif) ---
  getOpenMatches: (slug: string, token?: string) =>
    request<OpenMatch[]>(`/api/clubs/${slug}/open-matches`, {}, token),
  getOpenMatch: (slug: string, id: string, token?: string) =>
    request<OpenMatch>(`/api/clubs/${slug}/open-matches/${id}`, {}, token),
  joinOpenMatch: (slug: string, id: string, token: string, target?: JoinTarget) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/join`, { method: 'POST', ...(target ? { body: JSON.stringify(target) } : {}) }, token),
  leaveOpenMatch: (slug: string, id: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/join`, { method: 'DELETE' }, token),
  removeOpenMatchPlayer: (slug: string, id: string, userId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/participants/${userId}`, { method: 'DELETE' }, token),
  setOpenMatchTeams: (slug: string, id: string, teams: Record<string, 1 | 2>, token: string, slots?: Record<string, number>) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/participants/teams`, { method: 'POST', body: JSON.stringify({ teams, slots }) }, token),
  addOpenMatchPlayer: (slug: string, id: string, userId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/participants`, { method: 'POST', body: JSON.stringify({ userId }) }, token),
  markOpenMatchChatRead: (slug: string, id: string, token: string) =>
    request<{ count: number }>(`/api/clubs/${slug}/open-matches/${id}/chat/read`, { method: 'POST' }, token),
  getOpenMatchUnread: (slug: string, token: string) =>
    request<{ count: number }>(`/api/clubs/${slug}/open-matches/unread-count`, {}, token),
  listMyMatchAlerts: (slug: string, token: string) =>
    request<MatchAlert[]>(`/api/clubs/${slug}/match-alerts`, {}, token),
  createMatchAlert: (slug: string, body: { date: string; from: string; to: string; targetLevelMin?: number | null; targetLevelMax?: number | null }, token: string) =>
    request<MatchAlert>(`/api/clubs/${slug}/match-alerts`, { method: 'POST', body: JSON.stringify(body) }, token),
  deleteMatchAlert: (slug: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${slug}/match-alerts/${id}`, { method: 'DELETE' }, token),
  getChatMessages: (slug: string, id: string, token: string) =>
    request<OpenMatchMessage[]>(`/api/clubs/${slug}/open-matches/${id}/chat/messages`, {}, token),
  postChatMessage: (slug: string, id: string, body: string, token: string) =>
    request<OpenMatchMessage>(`/api/clubs/${slug}/open-matches/${id}/chat/messages`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  editChatMessage: (slug: string, id: string, messageId: string, body: string, token: string) =>
    request<OpenMatchMessage>(`/api/clubs/${slug}/open-matches/${id}/chat/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ body }) }, token),
  deleteChatMessage: (slug: string, id: string, messageId: string, token: string) =>
    request<OpenMatchMessage>(`/api/clubs/${slug}/open-matches/${id}/chat/messages/${messageId}`, { method: 'DELETE' }, token),
  reportChatMessage: (slug: string, id: string, messageId: string, reason: ReportReason, detail: string | null, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/chat/messages/${messageId}/report`,
      { method: 'POST', body: JSON.stringify({ reason, detail }) }, token),

  // --- Back-office club (scopé par clubId) ---
  adminGetClub: (clubId: string, token: string) =>
    request<ClubAdminDetail>(`/api/clubs/${clubId}/admin`, {}, token),

  adminGetOnboardingStatus: (clubId: string, token: string) =>
    request<OnboardingStatus>(`/api/clubs/${clubId}/admin/onboarding-status`, {}, token),

  adminListReports: (clubId: string, token: string, status?: ReportStatus) =>
    request<{ items: MessageReportRow[] }>(`/api/clubs/${clubId}/admin/moderation/reports${status ? `?status=${status}` : ''}`, {}, token),
  adminResolveReport: (clubId: string, reportId: string, action: 'DELETE' | 'REJECT', token: string) =>
    request<MessageReportRow>(`/api/clubs/${clubId}/admin/moderation/reports/${reportId}/resolve`,
      { method: 'POST', body: JSON.stringify({ action }) }, token),

  // --- Abonnement Palova du club (facturation SaaS) ---
  adminGetBilling: (clubId: string, token: string) =>
    request<ClubBilling>(`/api/clubs/${clubId}/admin/billing`, {}, token),

  adminBillingCheckout: (clubId: string, interval: 'month' | 'year', returnUrl: string, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/billing/checkout`, {
      method: 'POST', body: JSON.stringify({ interval, returnUrl }),
    }, token),

  adminBillingPortal: (clubId: string, returnUrl: string, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/billing/portal`, {
      method: 'POST', body: JSON.stringify({ returnUrl }),
    }, token),

  adminGetMembers: (clubId: string, token: string) =>
    request<Member[]>(`/api/clubs/${clubId}/admin/members`, {}, token),

  adminAddMemberByEmail: (clubId: string, email: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/members`, { method: 'POST', body: JSON.stringify({ email }) }, token),

  // `member` = ligne membre déjà prête (le back la construit lui-même) : les appelants n'ont
  // plus besoin d'un `adminGetMembers` complet pour retrouver le membre qu'ils viennent de créer.
  adminCreateMember: (clubId: string, body: CreateMemberBody, token: string) =>
    request<{ tempPassword: string | null; existed: boolean; userId: string; member: Member }>(`/api/clubs/${clubId}/admin/members/create`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateMember: (clubId: string, id: string, body: UpdateMemberBody, token: string) =>
    request<Member>(`/api/clubs/${clubId}/admin/members/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminSetMemberBlocked: (clubId: string, id: string, blocked: boolean, token: string) =>
    request<Member>(`/api/clubs/${clubId}/admin/members/${id}/blocked`, { method: 'PATCH', body: JSON.stringify({ blocked }) }, token),

  adminRemoveMember: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/members/${id}`, { method: 'DELETE' }, token),

  adminUpdateClub: (clubId: string, body: UpdateClubBody, token: string) =>
    request<ClubAdminDetail>(`/api/clubs/${clubId}/admin`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  // Upload du logo du club en FormData. variant: 'icon' (défaut) | 'wide' | 'wide-dark'.
  uploadClubLogo: async (
    clubId: string, file: File, token: string, variant: 'icon' | 'wide' | 'wide-dark' = 'icon',
  ): Promise<{ logoUrl?: string; logoWideUrl?: string; logoWideDarkUrl?: string; warnings: string[] }> => {
    const form = new FormData();
    form.append('logo', file);
    const path = variant === 'icon' ? 'club-logo' : `club-logo/${variant}`;
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload échoué');
    return res.json();
  },

  // Suppression d'un logotype optionnel (l'icône n'est que remplaçable).
  deleteClubLogoVariant: async (
    clubId: string, variant: 'wide' | 'wide-dark', token: string,
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/club-logo/${variant}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Suppression échouée');
  },

  // Upload de la couverture du club en FormData — fetch dédié. Persiste côté serveur.
  uploadClubCover: async (clubId: string, file: File, token: string): Promise<{ coverImageUrl: string }> => {
    const form = new FormData();
    form.append('cover', file);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/club-cover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  adminGetSports: (clubId: string, token: string) =>
    request<AdminClubSport[]>(`/api/clubs/${clubId}/admin/sports`, {}, token),

  adminAddSport: (clubId: string, sportId: string, token: string) =>
    request<AdminClubSport>(`/api/clubs/${clubId}/admin/sports`, { method: 'POST', body: JSON.stringify({ sportId }) }, token),

  adminUpdateClubSport: (clubId: string, clubSportId: string, durationsMin: number[], token: string) =>
    request<AdminClubSport>(`/api/clubs/${clubId}/admin/sports/${clubSportId}`, { method: 'PATCH', body: JSON.stringify({ durationsMin }) }, token),

  adminGetResources: (clubId: string, token: string) =>
    request<AdminResource[]>(`/api/clubs/${clubId}/admin/resources`, {}, token),

  adminCreateResource: (clubId: string, body: CreateResourceBody, token: string) =>
    request<AdminResource>(`/api/clubs/${clubId}/admin/resources`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateResource: (clubId: string, id: string, body: UpdateResourceBody, token: string) =>
    request<AdminResource>(`/api/clubs/${clubId}/admin/resources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminSetResourceActive: (clubId: string, id: string, isActive: boolean, token: string) =>
    request<AdminResource>(`/api/clubs/${clubId}/admin/resources/${id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive }) }, token),

  adminReorderResources: (clubId: string, orderedIds: string[], token: string) =>
    request<AdminResource[]>(`/api/clubs/${clubId}/admin/resources/reorder`, { method: 'PATCH', body: JSON.stringify({ orderedIds }) }, token),

  adminDeleteResource: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/resources/${id}`, { method: 'DELETE' }, token),

  adminGetReservations: (clubId: string, filters: AdminReservationFilters, token: string) => {
    const qs = new URLSearchParams();
    if (filters.date)       qs.set('date', filters.date);
    if (filters.resourceId) qs.set('resourceId', filters.resourceId);
    if (filters.status)     qs.set('status', filters.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<ClubReservationsResponse>(`/api/clubs/${clubId}/admin/reservations${suffix}`, {}, token);
  },

  adminCancelReservation: (clubId: string, reservationId: string, token: string) =>
    request<Reservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}`, { method: 'DELETE' }, token),

  adminSetReservationType: (clubId: string, reservationId: string, type: ReservationType, token: string) =>
    request<Reservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}`, { method: 'PATCH', body: JSON.stringify({ type }) }, token),

  adminCreateReservation: (clubId: string, body: CreateReservationBody, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminRescheduleReservation: (clubId: string, reservationId: string, body: RescheduleReservationBody, token: string) =>
    request<Reservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/schedule`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminAddPayment: (clubId: string, reservationId: string, body: AddPaymentBody, token: string) =>
    request<Payment>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/payments`, { method: 'POST', body: JSON.stringify(body) }, token),

  // Balayage automatique (Caisse/Planning) : couvre par abonnement les places non réglées du jour.
  adminAutoApplySubscriptions: (clubId: string, date: string, token: string) =>
    request<{ applied: number }>(`/api/clubs/${clubId}/admin/reservations/auto-apply-subscriptions`, { method: 'POST', body: JSON.stringify({ date }) }, token),

  adminAssignReservationMember: (clubId: string, reservationId: string, memberUserId: string, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/member`, { method: 'PATCH', body: JSON.stringify({ memberUserId }) }, token),

  adminAddReservationParticipant: (clubId: string, reservationId: string, memberUserId: string, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/participants`, { method: 'POST', body: JSON.stringify({ memberUserId }) }, token),

  adminRemoveReservationParticipant: (clubId: string, reservationId: string, participantId: string, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/participants/${participantId}`, { method: 'DELETE' }, token),

  // Remplace un participant par un autre membre, en une fois (recalcule les parts).
  adminChangeReservationParticipant: (clubId: string, reservationId: string, participantId: string, memberUserId: string, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/participants/${participantId}`, { method: 'PATCH', body: JSON.stringify({ memberUserId }) }, token),

  // Variantes « créer un joueur puis l'associer » — un seul aller-retour réseau (le serveur crée
  // le membre ET l'associe dans la même requête ; `ClubReservation.createdMember` porte le résultat
  // de la création). Avant, le client faisait `adminCreateMember` puis un `adminGetMembers` complet
  // pour retrouver l'id créé, puis l'appel d'association : 3 allers-retours au lieu d'1.
  adminAssignReservationMemberNew: (clubId: string, reservationId: string, newMember: CreateMemberBody, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/member`, { method: 'PATCH', body: JSON.stringify({ newMember }) }, token),

  adminAddReservationParticipantNew: (clubId: string, reservationId: string, newMember: CreateMemberBody, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/participants`, { method: 'POST', body: JSON.stringify({ newMember }) }, token),

  adminChangeReservationParticipantNew: (clubId: string, reservationId: string, participantId: string, newMember: CreateMemberBody, token: string) =>
    request<ClubReservation>(`/api/clubs/${clubId}/admin/reservations/${reservationId}/participants/${participantId}`, { method: 'PATCH', body: JSON.stringify({ newMember }) }, token),

  // --- Abonnements (admin) ---
  adminGetSubscriptionPlans: (clubId: string, token: string) =>
    request<SubscriptionPlan[]>(`/api/clubs/${clubId}/admin/subscription-plans`, {}, token),
  adminCreateSubscriptionPlan: (clubId: string, body: CreateSubscriptionPlanBody, token: string) =>
    request<SubscriptionPlan>(`/api/clubs/${clubId}/admin/subscription-plans`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminUpdateSubscriptionPlan: (clubId: string, id: string, body: UpdateSubscriptionPlanBody, token: string) =>
    request<SubscriptionPlan>(`/api/clubs/${clubId}/admin/subscription-plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  /** Upload de l'affiche d'un abonnement : fetch dédié (FormData), pattern uploadMyAvatar. */
  adminUploadSubscriptionPlanImage: async (clubId: string, id: string, file: File, token: string): Promise<SubscriptionPlan> => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/subscription-plans/${id}/image`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<SubscriptionPlan>;
  },
  adminGetMemberSubscriptions: (clubId: string, userId: string, token: string) =>
    request<Subscription[]>(`/api/clubs/${clubId}/admin/members/${userId}/subscriptions`, {}, token),
  adminSellSubscription: (clubId: string, userId: string, body: SellSubscriptionBody, token: string) =>
    request<{ subscription: Subscription; payment: Payment }>(`/api/clubs/${clubId}/admin/members/${userId}/subscriptions`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminGetSubscriptionOverview: (clubId: string, token: string) =>
    request<SubscriptionOverview>(`/api/clubs/${clubId}/admin/subscriptions/overview`, {}, token),
  adminRenewSubscription: (clubId: string, id: string, body: RenewSubscriptionBody, token: string) =>
    request<{ subscription: Subscription; payment: Payment }>(`/api/clubs/${clubId}/admin/subscriptions/${id}/renew`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminChangeSubscription: (clubId: string, id: string, body: ChangeSubscriptionBody, token: string) =>
    request<{ subscription: Subscription; payment: Payment }>(`/api/clubs/${clubId}/admin/subscriptions/${id}/change`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminCancelSubscription: (clubId: string, id: string, token: string) =>
    request<{ id: string; status: SubscriptionStatus }>(`/api/clubs/${clubId}/admin/subscriptions/${id}/cancel`, { method: 'POST' }, token),

  // --- Offres prépayées & caisse ---
  adminGetPackageTemplates: (clubId: string, token: string) =>
    request<PackageTemplate[]>(`/api/clubs/${clubId}/admin/packages/templates`, {}, token),

  adminCreatePackageTemplate: (clubId: string, body: CreatePackageTemplateBody, token: string) =>
    request<PackageTemplate>(`/api/clubs/${clubId}/admin/packages/templates`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdatePackageTemplate: (clubId: string, id: string, body: UpdatePackageTemplateBody, token: string) =>
    request<PackageTemplate>(`/api/clubs/${clubId}/admin/packages/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  /** Upload de l'affiche d'une offre prépayée : fetch dédié (FormData), pattern uploadMyAvatar. */
  adminUploadPackageTemplateImage: async (clubId: string, id: string, file: File, token: string): Promise<PackageTemplate> => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/packages/templates/${id}/image`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<PackageTemplate>;
  },

  adminGetMemberPackages: (clubId: string, userId: string, token: string) =>
    request<MemberPackage[]>(`/api/clubs/${clubId}/admin/members/${userId}/packages`, {}, token),

  adminGetActivePackages: (clubId: string, token: string) =>
    request<ActiveMemberPackage[]>(`/api/clubs/${clubId}/admin/packages/active`, {}, token),

  adminGetMemberHistory: (clubId: string, userId: string, token: string) =>
    request<MemberHistory>(`/api/clubs/${clubId}/admin/members/${userId}/history`, {}, token),

  adminGetMemberNotes: (clubId: string, userId: string, token: string) =>
    request<MemberNote[]>(`/api/clubs/${clubId}/admin/members/${userId}/notes`, {}, token),

  adminAddMemberNote: (clubId: string, userId: string, body: string, token: string) =>
    request<MemberNote>(`/api/clubs/${clubId}/admin/members/${userId}/notes`, { method: 'POST', body: JSON.stringify({ body }) }, token),

  adminDeleteMemberNote: (clubId: string, userId: string, noteId: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/members/${userId}/notes/${noteId}`, { method: 'DELETE' }, token),

  adminSetMemberWatch: (clubId: string, userId: string, watch: boolean, token: string) =>
    request<{ userId: string; watch: boolean }>(`/api/clubs/${clubId}/admin/members/${userId}/watch`, { method: 'PATCH', body: JSON.stringify({ watch }) }, token),

  adminSetMemberStaffRole: (clubId: string, userId: string, role: 'ADMIN' | 'STAFF' | null, token: string) =>
    request<{ userId: string; staffRole: 'ADMIN' | 'STAFF' | null }>(`/api/clubs/${clubId}/admin/members/${userId}/staff-role`, { method: 'PATCH', body: JSON.stringify({ role }) }, token),

  adminSetMemberCoach: (clubId: string, userId: string, isCoach: boolean, token: string) =>
    request<{ userId: string; isCoach: boolean }>(`/api/clubs/${clubId}/admin/members/${userId}/coach`, { method: 'PATCH', body: JSON.stringify({ isCoach }) }, token),

  adminSellPackage: (clubId: string, userId: string, body: SellPackageBody, token: string) =>
    request<{ package: MemberPackage; payment: Payment }>(`/api/clubs/${clubId}/admin/members/${userId}/packages`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminRechargePackage: (clubId: string, userId: string, packageId: string, body: RechargePackageBody, token: string) =>
    request<{ package: MemberPackage; payment: Payment }>(`/api/clubs/${clubId}/admin/members/${userId}/packages/${packageId}/recharge`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminAdjustPackage: (clubId: string, userId: string, packageId: string, body: AdjustPackageBody, token: string) =>
    request<{ package: MemberPackage }>(`/api/clubs/${clubId}/admin/members/${userId}/packages/${packageId}/adjust`, { method: 'POST', body: JSON.stringify(body) }, token),

  // --- Override admin du niveau (réservé ADMIN/OWNER) ---
  // Fiche niveau d'un membre : niveaux courants par sport + historique des corrections.
  adminGetMemberLevel: (clubId: string, userId: string, token: string) =>
    request<AdminMemberLevel>(`/api/clubs/${clubId}/admin/members/${userId}/level`, {}, token),

  // Corrige le niveau (0–8) d'un membre pour un sport ; renvoie l'affichage du niveau mis à jour.
  adminSetMemberLevel: (clubId: string, userId: string, body: { sportKey: string; level: number; reason?: string }, token: string) =>
    request<MyRating>(`/api/clubs/${clubId}/admin/members/${userId}/level`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminGetCaisse: (clubId: string, date: string, token: string) =>
    request<CaisseSummary>(`/api/clubs/${clubId}/admin/caisse?date=${date}`, {}, token),

  adminGetVouchers: (clubId: string, status: VoucherStatus | '', token: string) =>
    request<CaissePayment[]>(`/api/clubs/${clubId}/admin/caisse/vouchers${status ? `?status=${status}` : ''}`, {}, token),

  adminSetVoucherStatus: (clubId: string, paymentId: string, status: VoucherStatus, token: string) =>
    request<Payment>(`/api/clubs/${clubId}/admin/payments/${paymentId}/voucher`, { method: 'PATCH', body: JSON.stringify({ status }) }, token),

  refundPayment: (clubId: string, paymentId: string, body: { amount: number; reason?: string; method?: string }, token: string) =>
    request<Refund>(`/api/clubs/${clubId}/admin/payments/${paymentId}/refunds`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminAccountingSummary: (clubId: string, year: number, month: number, token: string) =>
    request<MonthlySummary>(`/api/clubs/${clubId}/admin/accounting/summary?year=${year}&month=${month}`, {}, token),

  adminAccountingExport: async (clubId: string, from: string, to: string, token: string): Promise<Blob> => {
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/accounting/export?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },

  // --- Annonces & sponsors (page d'accueil club) ---
  getClubAnnouncements: (slug: string) => request<Announcement[]>(`/api/clubs/${slug}/announcements`),
  getClubSponsors: (slug: string) => request<Sponsor[]>(`/api/clubs/${slug}/sponsors`),

  adminGetAnnouncements: (clubId: string, token: string) =>
    request<Announcement[]>(`/api/clubs/${clubId}/admin/announcements`, {}, token),
  adminCreateAnnouncement: (clubId: string, body: AnnouncementBody, token: string) =>
    request<Announcement>(`/api/clubs/${clubId}/admin/announcements`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminUpdateAnnouncement: (clubId: string, id: string, body: AnnouncementBody, token: string) =>
    request<Announcement>(`/api/clubs/${clubId}/admin/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  adminDeleteAnnouncement: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/announcements/${id}`, { method: 'DELETE' }, token),
  adminReorderAnnouncements: (clubId: string, orderedIds: string[], token: string) =>
    request<Announcement[]>(`/api/clubs/${clubId}/admin/announcements/reorder`, { method: 'PATCH', body: JSON.stringify({ orderedIds }) }, token),
  /** Upload de l'affiche d'une annonce : fetch dédié (FormData), pattern uploadMyAvatar. */
  adminUploadAnnouncementImage: async (clubId: string, id: string, file: File, token: string): Promise<Announcement> => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/announcements/${id}/image`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<Announcement>;
  },

  // --- Club-house v2 : présentation, offres, top du mois ---
  getClubPresentation: (slug: string) => request<ClubPresentation>(`/api/clubs/${encodeURIComponent(slug)}/presentation`),
  getClubOffers: (slug: string) => request<PublicOffers>(`/api/clubs/${encodeURIComponent(slug)}/offers`),
  getClubTopMonth: (slug: string) => request<TopMonthEntry[]>(`/api/clubs/${encodeURIComponent(slug)}/top-month`),
  createOfferPlanIntent: (slug: string, planId: string, token: string) =>
    request<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret: string | null; type: 'payment' }>(
      `/api/clubs/${encodeURIComponent(slug)}/offers/plans/${planId}/intent`, { method: 'POST' }, token),
  createOfferPackageIntent: (slug: string, templateId: string, token: string) =>
    request<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret: string | null; type: 'payment' }>(
      `/api/clubs/${encodeURIComponent(slug)}/offers/packages/${templateId}/intent`, { method: 'POST' }, token),
  confirmOfferPayment: (slug: string, stripePaymentIntentId: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${encodeURIComponent(slug)}/offers/confirm`,
      { method: 'POST', body: JSON.stringify({ stripePaymentIntentId }) }, token),
  adminGetPresentation: (clubId: string, token: string) =>
    request<ClubPresentation>(`/api/clubs/${clubId}/admin/presentation`, {}, token),
  adminUpdatePresentation: (clubId: string, body: Partial<Pick<ClubPresentation, 'presentationText' | 'contactPhone' | 'contactEmail' | 'openingHoursText' | 'foundedYear' | 'amenities'>>, token: string) =>
    request<ClubPresentation>(`/api/clubs/${clubId}/admin/presentation`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  adminUpdateClubPhoto: (clubId: string, id: string, body: { caption?: string | null; sortOrder?: number }, token: string) =>
    request<ClubPhoto>(`/api/clubs/${clubId}/admin/photos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  adminDeleteClubPhoto: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/photos/${id}`, { method: 'DELETE' }, token),
  /** Upload d'une photo de galerie : fetch dédié (FormData), pattern uploadMyAvatar. */
  adminAddClubPhoto: async (clubId: string, file: File, caption: string | undefined, token: string): Promise<ClubPhoto> => {
    const form = new FormData();
    form.append('photo', file);
    if (caption) form.append('caption', caption);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/photos`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<ClubPhoto>;
  },

  adminGetSponsors: (clubId: string, token: string) =>
    request<Sponsor[]>(`/api/clubs/${clubId}/admin/sponsors`, {}, token),
  adminCreateSponsor: (clubId: string, body: SponsorBody, token: string) =>
    request<Sponsor>(`/api/clubs/${clubId}/admin/sponsors`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminUpdateSponsor: (clubId: string, id: string, body: SponsorBody, token: string) =>
    request<Sponsor>(`/api/clubs/${clubId}/admin/sponsors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  adminDeleteSponsor: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/sponsors/${id}`, { method: 'DELETE' }, token),
  // Upload du logo partenaire (multipart) → renvoie le chemin /uploads à stocker dans logoUrl.
  uploadSponsorLogo: async (clubId: string, file: File, token: string): Promise<{ logoUrl: string }> => {
    const form = new FormData();
    form.append('logo', file);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/sponsors/logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // --- Tournois (public + joueur) ---
  getClubTournaments: (slug: string) => request<Tournament[]>(`/api/clubs/${slug}/tournaments`),

  getTournament: (id: string) => request<TournamentDetail>(`/api/tournaments/${id}`),

  getTournamentParticipants: (id: string) => request<TournamentParticipant[]>(`/api/tournaments/${id}/participants`),

  registerTournament: (id: string, partnerUserId: string, token: string) =>
    request<{ registration: TournamentRegistrationRecord; payment: RegistrationPaymentInfo }>(`/api/tournaments/${id}/register`, { method: 'POST', body: JSON.stringify({ partnerUserId }) }, token),

  changeTournamentPartner: (id: string, partnerUserId: string, token: string) =>
    request<TournamentRegistrationRecord>(`/api/tournaments/${id}/registration`, { method: 'PATCH', body: JSON.stringify({ partnerUserId }) }, token),

  cancelTournamentRegistration: (id: string, token: string) =>
    request<TournamentRegistrationRecord>(`/api/tournaments/${id}/registration`, { method: 'DELETE' }, token),

  // --- Events (public + joueur) ---
  getClubEvents: (slug: string) => request<ClubEvent[]>(`/api/clubs/${slug}/events`),

  getEvent: (id: string) => request<ClubEventDetail>(`/api/events/${id}`),

  getEventParticipants: (id: string) => request<EventParticipant[]>(`/api/events/${id}/participants`),

  registerEvent: (id: string, token: string) =>
    request<{ registration: EventRegistrationRecord; payment: RegistrationPaymentInfo }>(`/api/events/${id}/register`, { method: 'POST' }, token),

  cancelEventRegistration: (id: string, token: string) =>
    request<EventRegistrationRecord>(`/api/events/${id}/registration`, { method: 'DELETE' }, token),

  // --- Profil joueur ---
  getMyProfile: (token: string) => request<MyProfile>('/api/me/profile', {}, token),

  updateMyProfile: (body: { phone?: string | null; sex?: Sex | null; birthDate?: string | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; acceptsDirectMessages?: boolean; preferredSportId?: string | null }, token: string) =>
    request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),

  // --- Niveau Glicko-2 ---
  getMyRating: (token: string, sport?: string) =>
    request<MyRating | null>(`/api/me/rating${sport ? `?sport=${encodeURIComponent(sport)}` : ''}`, {}, token),

  calibrateRating: (selfLevel: number | null, token: string, sport?: string) =>
    request<MyRating>('/api/me/rating/calibrate', { method: 'POST', body: JSON.stringify({ selfLevel, ...(sport ? { sport } : {}) }) }, token),

  getRatingHistory: (token: string, sport?: string) =>
    request<RatingPoint[]>(`/api/me/rating/history${sport ? `?sport=${encodeURIComponent(sport)}` : ''}`, {}, token),

  getClubLeaderboard: (slug: string, token: string, sport = 'padel') =>
    request<ClubLeaderboard>(`/api/clubs/${encodeURIComponent(slug)}/leaderboard?sport=${encodeURIComponent(sport)}`, {}, token),

  getMyClubMatchStats: (slug: string, token: string, sport = 'padel') =>
    request<ClubMatchStats>(`/api/clubs/${encodeURIComponent(slug)}/me/match-stats?sport=${encodeURIComponent(sport)}`, {}, token),

  // Upload d'avatar en FormData — fetch dédié : request() force Content-Type JSON.
  uploadMyAvatar: async (file: File, token: string): Promise<MyProfile> => {
    const form = new FormData();
    form.append('avatar', file);
    const res = await fetch(`${BASE_URL}/api/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // --- Annuaire & adhésion (club courant) ---
  searchClubMembers: (slug: string, q: string, token: string) =>
    request<ClubMemberSearchResult[]>(`/api/clubs/${slug}/members/search?q=${encodeURIComponent(q)}`, {}, token),

  // --- Amis / suivi ---
  listClubFriends: (slug: string, token: string, q?: string) =>
    request<Friend[]>(`/api/clubs/${slug}/friends${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
  listFollowing: (token: string, q?: string) =>
    request<Friend[]>(`/api/me/following${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
  listFollowers: (token: string) =>
    request<Friend[]>(`/api/me/followers`, {}, token),
  followUser: (slug: string, userId: string, token: string) =>
    request<FollowRelation>(`/api/clubs/${slug}/follows/${userId}`, { method: 'POST' }, token),
  unfollowUser: (slug: string, userId: string, token: string) =>
    request<FollowRelation>(`/api/clubs/${slug}/follows/${userId}`, { method: 'DELETE' }, token),
  requestFriend: (slug: string, userId: string, token: string) =>
    request<FriendRelation>(`/api/clubs/${slug}/friends/${userId}/request`, { method: 'POST' }, token),
  respondFriend: (slug: string, userId: string, accept: boolean, token: string) =>
    request<FriendRelation>(`/api/clubs/${slug}/friends/${userId}/respond`, { method: 'POST', body: JSON.stringify({ accept }) }, token),
  removeFriend: (slug: string, userId: string, token: string) =>
    request<FriendRelation>(`/api/clubs/${slug}/friends/${userId}`, { method: 'DELETE' }, token),
  listFriendships: (token: string, q?: string) =>
    request<Friend[]>(`/api/me/friendships${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
  listFriendRequests: (token: string) =>
    request<FriendRequests>(`/api/me/friend-requests`, {}, token),
  getFriendsAgenda: (slug: string, token: string) =>
    request<FriendsAgendaItem[]>(`/api/clubs/${slug}/me/friends-agenda`, {}, token),
  getPlayerSuggestions: (slug: string, token: string) =>
    request<PlayerSuggestion[]>(`/api/clubs/${slug}/me/player-suggestions`, {}, token),

  // --- Messagerie privée ---
  listConversations: (token: string) => request<ConversationSummary[]>('/api/me/conversations', {}, token),
  getDmUnread: (token: string) => request<{ count: number }>('/api/me/conversations/unread-count', {}, token),
  openConversation: (otherUserId: string, token: string, clubSlug?: string | null) =>
    request<ConversationSummary>('/api/me/conversations', { method: 'POST', body: JSON.stringify({ otherUserId, clubSlug }) }, token),
  getDmMessages: (conversationId: string, token: string, before?: string | null) =>
    request<{ messages: DmMessage[]; meta: DmMeta }>(
      `/api/conversations/${conversationId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`, {}, token),
  postDmMessage: (conversationId: string, body: string, token: string) =>
    request<DmMessage>(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  editDmMessage: (conversationId: string, messageId: string, body: string, token: string) =>
    request<DmMessage>(`/api/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ body }) }, token),
  deleteDmMessage: (conversationId: string, messageId: string, token: string) =>
    request<DmMessage>(`/api/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }, token),
  reportDmMessage: (conversationId: string, messageId: string, reason: ReportReason, detail: string | null, token: string) =>
    request<{ id: string }>(`/api/conversations/${conversationId}/messages/${messageId}/report`,
      { method: 'POST', body: JSON.stringify({ reason, detail }) }, token),
  addDmReaction: (conversationId: string, messageId: string, emoji: string, token: string) =>
    request<DmReaction[]>(`/api/conversations/${conversationId}/messages/${messageId}/reactions`,
      { method: 'POST', body: JSON.stringify({ emoji }) }, token),
  removeDmReaction: (conversationId: string, messageId: string, emoji: string, token: string) =>
    request<DmReaction[]>(`/api/conversations/${conversationId}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
      { method: 'DELETE' }, token),
  markConversationRead: (conversationId: string, token: string) =>
    request<{ lastReadAt: string }>(`/api/conversations/${conversationId}/read`, { method: 'POST' }, token),
  sendTyping: (conversationId: string, token: string) =>
    request<{ ok: true }>(`/api/conversations/${conversationId}/typing`, { method: 'POST' }, token),
  /** Upload photo : fetch dédié (FormData — pas de Content-Type JSON), pattern uploadMyAvatar. */
  uploadDmImage: async (conversationId: string, file: File, caption: string, token: string): Promise<DmMessage> => {
    const form = new FormData();
    form.append('image', file);
    if (caption) form.append('body', caption);
    const res = await fetch(`${BASE_URL}/api/conversations/${conversationId}/images`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<DmMessage>;
  },
  blockUser: (userId: string, token: string) =>
    request<{ blocked: true }>(`/api/me/blocks/${userId}`, { method: 'POST' }, token),
  unblockUser: (userId: string, token: string) =>
    request<{ blocked: false }>(`/api/me/blocks/${userId}`, { method: 'DELETE' }, token),
  listBlockedUsers: (token: string) => request<DmUserInfo[]>('/api/me/blocks', {}, token),

  getMyClubMembership: (slug: string, token: string) =>
    request<MyClubMembership>(`/api/clubs/${slug}/me/membership`, {}, token),

  updateMyClubMembership: (slug: string, membershipNo: string, token: string) =>
    request<MyClubMembership>(`/api/clubs/${slug}/me/membership`, { method: 'PATCH', body: JSON.stringify({ membershipNo }) }, token),

  // Soldes prépayés du joueur sur ce club.
  getMyClubPackages: (slug: string, token: string) =>
    request<MemberPackage[]>(`/api/clubs/${slug}/me/packages`, {}, token),

  // Le club a-t-il déjà une carte enregistrée pour le joueur (empreinte no-show) ?
  getMyCardStatus: (slug: string, token: string) =>
    request<{ hasCardOnFile: boolean }>(`/api/clubs/${slug}/me/card-status`, {}, token),

  // Carte enregistrée du joueur (club courant) : marque + 4 chiffres + expiration.
  getMyPaymentMethod: (slug: string, token: string) =>
    request<MyPaymentMethod | null>(`/api/clubs/${slug}/me/payment-method`, {}, token),
  removeMyPaymentMethod: (slug: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${slug}/me/payment-method`, { method: 'DELETE' }, token),

  // Historique des paiements du joueur (club courant).
  getMyPayments: (slug: string, token: string) =>
    request<MyPayment[]>(`/api/clubs/${slug}/me/payments`, {}, token),

  // Abonnements actifs du joueur sur ce club.
  getMyClubSubscriptions: (slug: string, token: string) =>
    request<Subscription[]>(`/api/clubs/${slug}/me/subscriptions`, {}, token),

  getMyQuotaStatus: (slug: string, token: string) =>
    request<MyQuotaStatus | null>(`/api/clubs/${slug}/me/quota-status`, {}, token),

  getMyTournaments: (token: string) => request<MyTournamentRegistration[]>('/api/me/tournaments', {}, token),

  getMyEvents: (token: string) => request<MyEventRegistration[]>('/api/me/events', {}, token),

  // --- Tournois (back-office club) ---
  adminGetTournaments: (clubId: string, token: string) =>
    request<Tournament[]>(`/api/clubs/${clubId}/admin/tournaments`, {}, token),

  adminGetTournament: (clubId: string, id: string, token: string) =>
    request<AdminTournamentDetail>(`/api/clubs/${clubId}/admin/tournaments/${id}`, {}, token),

  adminCreateTournament: (clubId: string, body: CreateTournamentBody, token: string) =>
    request<Tournament>(`/api/clubs/${clubId}/admin/tournaments`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateTournament: (clubId: string, id: string, body: UpdateTournamentBody, token: string) =>
    request<Tournament>(`/api/clubs/${clubId}/admin/tournaments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminDeleteTournament: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/tournaments/${id}`, { method: 'DELETE' }, token),

  adminPromoteRegistration: (clubId: string, tournamentId: string, regId: string, token: string) =>
    request<AdminRegistration>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}`, { method: 'PATCH' }, token),

  adminRemoveRegistration: (clubId: string, tournamentId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}`, { method: 'DELETE' }, token),

  // --- Events (back-office club) ---
  adminGetEvents: (clubId: string, token: string) =>
    request<ClubEvent[]>(`/api/clubs/${clubId}/admin/events`, {}, token),

  adminGetEvent: (clubId: string, id: string, token: string) =>
    request<AdminEventDetail>(`/api/clubs/${clubId}/admin/events/${id}`, {}, token),

  adminCreateEvent: (clubId: string, body: CreateEventBody, token: string) =>
    request<ClubEvent>(`/api/clubs/${clubId}/admin/events`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateEvent: (clubId: string, id: string, body: UpdateEventBody, token: string) =>
    request<ClubEvent>(`/api/clubs/${clubId}/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminDeleteEvent: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/events/${id}`, { method: 'DELETE' }, token),

  adminPromoteEventRegistration: (clubId: string, eventId: string, regId: string, token: string) =>
    request<AdminEventRegistration>(`/api/clubs/${clubId}/admin/events/${eventId}/registrations/${regId}`, { method: 'PATCH' }, token),

  adminRemoveEventRegistration: (clubId: string, eventId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/events/${eventId}/registrations/${regId}`, { method: 'DELETE' }, token),

  // --- Plateforme (super-admin) ---
  platformStats: (token: string) => request<PlatformStats>('/api/platform/stats', {}, token),

  platformListReports: (token: string, status?: ReportStatus) =>
    request<{ items: MessageReportRow[] }>(`/api/platform/moderation/reports${status ? `?status=${status}` : ''}`, {}, token),
  platformResolveReport: (reportId: string, action: 'DELETE' | 'REJECT', token: string) =>
    request<MessageReportRow>(`/api/platform/moderation/reports/${reportId}/resolve`,
      { method: 'POST', body: JSON.stringify({ action }) }, token),
  platformReportImage: async (reportId: string, token: string): Promise<Blob> => {
    const res = await fetch(`${BASE_URL}/api/platform/moderation/reports/${reportId}/image`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },

  platformClubs: (token: string) => request<PlatformClub[]>('/api/platform/clubs', {}, token),

  platformSetClubStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED', token: string) =>
    request<{ id: string; status: 'ACTIVE' | 'SUSPENDED' }>(`/api/platform/clubs/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }, token),

  platformSetBillingExempt: (id: string, exempt: boolean, token: string) =>
    request<{ id: string; billingExempt: boolean }>(`/api/platform/clubs/${id}/billing-exempt`, {
      method: 'PATCH', body: JSON.stringify({ exempt }),
    }, token),

  platformChangeClubSlug: (id: string, slug: string, token: string) =>
    request<{ id: string; slug: string; name: string }>(`/api/platform/clubs/${id}/slug`, {
      method: 'POST', body: JSON.stringify({ slug }),
    }, token),

  platformClubDetail: (id: string, token: string) =>
    request<PlatformClubDetail>(`/api/platform/clubs/${id}`, {}, token),

  platformSetSubscriptionTier: (id: string, body: { tier: number; interval?: 'month' | 'year' }, token: string) =>
    request<{ tier: number; interval: 'month' | 'year'; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }>(
      `/api/platform/clubs/${id}/billing/tier`, { method: 'POST', body: JSON.stringify(body) }, token),

  platformCancelSubscription: (id: string, token: string) =>
    request<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }>(
      `/api/platform/clubs/${id}/billing/cancel`, { method: 'POST' }, token),

  platformResumeSubscription: (id: string, token: string) =>
    request<{ cancelAtPeriodEnd: boolean }>(`/api/platform/clubs/${id}/billing/resume`, { method: 'POST' }, token),

  platformSyncInvoices: (token: string) =>
    request<{ clubs: number; imported: number }>('/api/platform/billing/sync-invoices', { method: 'POST' }, token),

  platformBillingOverview: (token: string) =>
    request<PlatformBillingOverview>('/api/platform/billing/overview', {}, token),

  platformUsageStats: (token: string) =>
    request<PlatformUsageStats>('/api/platform/stats/usage', {}, token),

  platformCreateClub: (body: CreateClubByPlatformBody, token: string) =>
    request<{ club: { id: string; slug: string; name: string }; owner: { id: string; email: string } }>(
      '/api/platform/clubs', { method: 'POST', body: JSON.stringify(body) }, token),
  platformCreateSport: (body: SportCatalogBody, token: string) =>
    request<Sport>('/api/platform/sports', { method: 'POST', body: JSON.stringify(body) }, token),
  platformUpdateSport: (id: string, body: SportCatalogBody, token: string) =>
    request<Sport>(`/api/platform/sports/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  platformDeleteSport: (id: string, token: string) =>
    request<{ id: string }>(`/api/platform/sports/${id}`, { method: 'DELETE' }, token),
  platformListSports: (token: string) =>
    request<Sport[]>('/api/platform/sports', {}, token),
  platformSetSportPublished: (id: string, published: boolean, token: string) =>
    request<Sport>(`/api/platform/sports/${id}`, { method: 'PATCH', body: JSON.stringify({ published }) }, token),

  // --- Contenu club : pages (CGV, mentions, confidentialité, offres) & FAQ ---
  // Public
  getClubFaq: (slug: string) => request<PublicClubFaq>(`/api/clubs/${slug}/faq`),
  getClubPage: (slug: string, kind: ClubPageKind) => request<PublicClubPage>(`/api/clubs/${slug}/pages/${kind}`),

  // Back-office : pages
  adminGetPages: (clubId: string, token: string) =>
    request<AdminClubPage[]>(`/api/clubs/${clubId}/admin/pages`, {}, token),
  adminGetPageTemplate: (clubId: string, kind: ClubPageKind, token: string) =>
    request<{ bodyMarkdown: string }>(`/api/clubs/${clubId}/admin/pages/${kind}/template`, {}, token),
  adminPutPage: (clubId: string, kind: ClubPageKind, body: PutPageBody, token: string) =>
    request<AdminClubPage>(`/api/clubs/${clubId}/admin/pages/${kind}`, { method: 'PUT', body: JSON.stringify(body) }, token),

  // Back-office : FAQ
  adminGetFaq: (clubId: string, token: string) =>
    request<AdminFaqItem[]>(`/api/clubs/${clubId}/admin/faq`, {}, token),
  adminCreateFaq: (clubId: string, body: FaqItemBody, token: string) =>
    request<AdminFaqItem>(`/api/clubs/${clubId}/admin/faq`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminUpdateFaq: (clubId: string, id: string, body: FaqItemBody, token: string) =>
    request<AdminFaqItem>(`/api/clubs/${clubId}/admin/faq/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  adminDeleteFaq: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/faq/${id}`, { method: 'DELETE' }, token),
  adminReorderFaq: (clubId: string, orderedIds: string[], token: string) =>
    request<AdminFaqItem[]>(`/api/clubs/${clubId}/admin/faq/reorder`, { method: 'PATCH', body: JSON.stringify({ orderedIds }) }, token),

  // --- Coachs (lecture seule : le statut coach se gère depuis adminSetMemberCoach) ---
  adminListCoaches: (clubId: string, token: string) =>
    request<Coach[]>(`/api/clubs/${clubId}/admin/coaches`, {}, token),

  /** Change le coach d'un cours existant (les élèves inscrits ne bougent pas). */
  adminSetLessonCoach: (clubId: string, lessonId: string, coachId: string, token: string) =>
    request<{ id: string; coach: { id: string; name: string; photoUrl: string | null } }>(
      `/api/clubs/${clubId}/admin/lessons/${lessonId}`, { method: 'PATCH', body: JSON.stringify({ coachId }) }, token),

  // --- Séries de réservations (back-office club) ---
  adminCreateSeries: (clubId: string, body: CreateSeriesBody, token: string) =>
    request<CreateSeriesResult>(`/api/clubs/${clubId}/admin/reservation-series`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminCancelSeries: (clubId: string, id: string, token: string) =>
    request<{ cancelled: number }>(`/api/clubs/${clubId}/admin/reservation-series/${id}`, { method: 'DELETE' }, token),

  // --- Élèves d'un cours (back-office club) ---
  adminListLessonStudents: (clubId: string, lessonId: string, token: string) =>
    request<LessonStudent[]>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students`, {}, token),

  adminEnrollStudent: (clubId: string, lessonId: string, userId: string, token: string) =>
    request<LessonStudent>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students`, { method: 'POST', body: JSON.stringify({ userId }) }, token),

  // Crée un joueur à la volée puis l'inscrit, en un seul aller-retour réseau.
  adminEnrollNewStudent: (clubId: string, lessonId: string, newMember: CreateMemberBody, token: string) =>
    request<LessonStudent>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students`, { method: 'POST', body: JSON.stringify({ newMember }) }, token),

  adminPromoteStudent: (clubId: string, lessonId: string, enrollId: string, token: string) =>
    request<LessonStudent>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students/${enrollId}`, { method: 'PATCH' }, token),

  adminRemoveStudent: (clubId: string, lessonId: string, enrollId: string, token: string) =>
    request<{ cancelledEnrollmentId: string; promotedEnrollmentId: string | null }>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students/${enrollId}`, { method: 'DELETE' }, token),

  // --- Cours (joueur) ---
  getClubLessons: (slug: string) => request<LessonSummary[]>(`/api/clubs/${slug}/lessons`),

  getLesson: (id: string) => request<LessonDetail>(`/api/lessons/${id}`),

  getLessonParticipants: (id: string) => request<LessonParticipant[]>(`/api/lessons/${id}/participants`),

  enrollLesson: (id: string, token: string) =>
    request<LessonEnrollmentRecord>(`/api/lessons/${id}/enrollment`, { method: 'POST' }, token),

  cancelLessonEnrollment: (id: string, token: string) =>
    request<{ cancelledEnrollmentId: string; promotedEnrollmentId: string | null }>(`/api/lessons/${id}/enrollment`, { method: 'DELETE' }, token),

  getMyLessons: (token: string) => request<MyLessonEnrollment[]>('/api/me/lessons', {}, token),

  // --- Espace coach (le coach connecté gère SES cours) ---
  getCoachStatus: (slug: string, token: string) =>
    request<{ isCoach: boolean }>(`/api/clubs/${slug}/me/coach`, {}, token),
  getCoachLessons: (slug: string, scope: 'upcoming' | 'past', token: string) =>
    request<CoachLessonRow[]>(`/api/clubs/${slug}/me/coach/lessons?scope=${scope}`, {}, token),
  coachEnrollStudent: (slug: string, lessonId: string, userId: string, token: string) =>
    request<{ id: string; status: string }>(`/api/clubs/${slug}/me/coach/lessons/${lessonId}/students`, { method: 'POST', body: JSON.stringify({ userId }) }, token),
  coachRemoveStudent: (slug: string, lessonId: string, enrollId: string, token: string) =>
    request<{ cancelledEnrollmentId: string; promotedEnrollmentId: string | null }>(`/api/clubs/${slug}/me/coach/lessons/${lessonId}/students/${enrollId}`, { method: 'DELETE' }, token),

  getVapidPublicKey: () => request<{ publicKey: string | null }>('/api/push/vapid-public-key'),
  savePushSubscription: (sub: unknown, token: string) =>
    request<{ ok: boolean }>('/api/me/push-subscriptions', { method: 'POST', body: JSON.stringify(sub) }, token),
  deletePushSubscription: (endpoint: string, token: string) =>
    request<{ ok: boolean }>('/api/me/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }, token),

  // --- Broadcasts (admin) ---
  getClubBroadcasts: (clubId: string, token: string) =>
    request<{ recipientCount: number; items: ClubBroadcastItem[] }>(`/api/clubs/${clubId}/admin/broadcasts`, {}, token),
  sendClubBroadcast: (clubId: string, body: { title: string; body: string; url?: string }, token: string) =>
    request<{ recipientCount: number; broadcastId: string }>(`/api/clubs/${clubId}/admin/broadcast`, { method: 'POST', body: JSON.stringify(body) }, token),

  // --- Emails automatiques personnalisables (admin) ---
  adminListEmails: (clubId: string, token: string) =>
    request<{ items: AdminEmailSummary[] }>(`/api/clubs/${clubId}/admin/emails`, {}, token),
  adminGetEmail: (clubId: string, type: string, token: string) =>
    request<AdminEmailDetail>(`/api/clubs/${clubId}/admin/emails/${type}`, {}, token),
  adminSaveEmail: (clubId: string, type: string, draft: EmailDraft, token: string) =>
    request<{ unknownVars: string[] }>(`/api/clubs/${clubId}/admin/emails/${type}`, { method: 'PUT', body: JSON.stringify(draft) }, token),
  adminResetEmail: (clubId: string, type: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/emails/${type}`, { method: 'DELETE' }, token),
  adminPreviewEmail: (clubId: string, type: string, draft: EmailDraft, token: string) =>
    request<{ subject: string; html: string }>(`/api/clubs/${clubId}/admin/emails/${type}/preview`, { method: 'POST', body: JSON.stringify(draft) }, token),
  adminTestEmail: (clubId: string, type: string, draft: EmailDraft, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/emails/${type}/test`, { method: 'POST', body: JSON.stringify(draft) }, token),
  /** Upload d'une image insérée dans un email personnalisé : fetch dédié (FormData). */
  adminUploadEmailImage: async (clubId: string, file: File, token: string): Promise<{ url: string }> => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/emails/images`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
};

// --- Types ---

// --- Broadcasts ---
export interface ClubBroadcastItem {
  id: string;
  title: string;
  body: string;
  url: string | null;
  recipientCount: number;
  createdAt: string;
}

// --- Emails automatiques personnalisables (admin) ---
export interface EmailVarDef { key: string; label: string; sample: string; }
export interface AdminEmailSummary { type: string; group: string; title: string; description: string; customized: boolean; }
export interface EmailDraft { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string; }
export interface AdminEmailDetail {
  type: string; group: string; title: string; description: string; hasCta: boolean;
  vars: EmailVarDef[];
  defaults: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string };
  override: { subject: string; heading: string; bodyHtml: string; ctaLabel: string | null; footerNote: string | null } | null;
}

// --- Notifications ---
export interface AppNotification {
  id: string; clubId: string | null; category: string; type: string;
  title: string; body: string; url: string | null; data: unknown;
  readAt: string | null; createdAt: string;
}
export interface NotificationPage { items: AppNotification[]; nextCursor: string | null; }
export interface NotifPrefRow { category: string; channel: string; enabled: boolean }

export interface Sport {
  id: string;
  key: string;
  name: string;
  resourceNoun: string;
  defaultSlotStepMin: number;
  defaultDurationsMin: number[];
  icon: string | null;
  surfaces: string[];
  published: boolean;
  hasLighting: boolean;
}

export interface SportCatalogBody {
  name: string;
  icon?: string;
  resourceNoun: string;
  defaultSlotStepMin: number;
  defaultDurationsMin: number[];
  surfaces: string[];
  hasLighting: boolean;
}

export interface ManagedClub {
  clubId: string;
  slug: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

export interface MyReservation {
  id: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  totalPrice: string;
  resource: { id: string; name: string; sport?: { key: string; name: string } | null; club: { name: string; slug: string; timezone: string; playerChangeCutoffHours?: number; cancellationCutoffHours?: number } };
  capacity: number;
  visibility?: 'PRIVATE' | 'PUBLIC';
  competitive?: boolean;
  targetLevelMin?: number | null;
  targetLevelMax?: number | null;
  participants: { id: string; userId: string; isOrganizer: boolean; firstName: string; lastName: string; avatarUrl: string | null; level?: UserLevel | null; team?: 1 | 2 | null; slot?: number | null }[];
}

export interface MyMatchPlayer {
  userId: string;
  team: number;
  firstName: string;
  lastName: string;
  isMe: boolean;
}

export interface MatchComment {
  id: string;
  body: string;
  createdAt: string;
  isStaff: boolean;
  author: { firstName: string; lastName: string; avatarUrl: string | null };
}
export interface MatchThread {
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  comments: MatchComment[];
}

export interface MyMatch {
  matchId: string;
  reservationId: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  sets: [number, number][];
  playedAt: string;
  winningTeam: number | null;
  competitive?: boolean;
  myTeam: number;
  myConfirmation: 'PENDING' | 'CONFIRMED' | 'DISPUTED';
  ratingAfter: number | null;
  needsMyConfirmation: boolean;
  commentCount: number;
  club: { name: string };
  sport: { name: string };
  resource: { name: string } | null;
  players: MyMatchPlayer[];
}

export interface MatchToRecordPlayer {
  userId: string;
  isOrganizer: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  team: 1 | 2;
  slot: number;
}

export interface MatchToRecord {
  reservationId: string;
  startTime: string;
  endTime: string;
  competitive?: boolean;
  visibility?: 'PRIVATE' | 'PUBLIC';
  club: { slug: string; name: string; timezone: string };
  resourceName: string;
  sport: { key: string; name: string };
  players: MatchToRecordPlayer[];
}

export interface ClubMatchPlayer {
  userId: string; team: number; confirmation: 'PENDING' | 'CONFIRMED' | 'DISPUTED';
  user: { firstName: string; lastName: string };
}
export interface ClubMatch {
  id: string; status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  sets: [number, number][]; playedAt: string; winningTeam: number | null; confirmDeadline: string;
  players: ClubMatchPlayer[];
  commentCount: number;
  cancelledAt?: string | null;
  cancelledReason?: string | null;
}

export interface ReservationPlayer {
  id: string;
  userId: string;
  isOrganizer: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  share: string;
  team?: 1 | 2 | null;
  slot?: number | null; // place au sein de l'équipe (0=G, 1=D), concrète en padel
}
export interface ReservationPlayers {
  id: string;
  capacity: number;
  participants: ReservationPlayer[];
  sportKey?: string;
}

export interface Resource {
  id: string;
  name: string;
  attributes: { surface?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean } & Record<string, unknown>;
  price: string;
  openHour: number;
  closeHour: number;
}

export interface ClubSportPublic {
  id: string;
  slotStepMin: number | null;
  durationsMin: number[];
  sport: Sport;
  resources: Resource[];
}

export interface ClubSummary {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  accentColor: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  sports: { key: string; name: string; icon: string | null }[];
  resourceCount: number;
}

export type BookingReleaseMode = 'DAY_AT_HOUR' | 'ROLLING_SLOT' | 'WINDOW_SHIFT';

// Sections du Club-house configurables par le club (ordre + visibilité).
// 'sponsors' = visibilité seule (position fixe en bas de page).
export type ClubHouseSectionKey = 'kiosk' | 'matches' | 'agenda' | 'top' | 'offers' | 'clubCard' | 'sponsors';
export interface ClubHouseSectionSetting { key: ClubHouseSectionKey; visible: boolean; }

export interface ClubDetail {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string | null;
  country: string | null;
  description: string | null;
  timezone: string;
  logoUrl: string | null;
  logoWideUrl: string | null;
  logoWideDarkUrl: string | null;
  coverImageUrl: string | null;
  accentColor: string;
  defaultThemeMode: string;
  status: string;
  publicBookingDays: number;
  memberBookingDays: number;
  bookingReleaseMode: BookingReleaseMode;
  publicReleaseHour: number;
  memberReleaseHour: number;
  showOtherClubsReservations: boolean;
  requireOnlinePayment: boolean;
  requireCardFingerprint: boolean;
  // Statut du compte Stripe Connect du club (enum non nullable côté Prisma,
  // défaut NONE). Sert à savoir si le paiement en ligne est réellement actif.
  stripeAccountStatus: string;
  levelSystemEnabled: boolean;
  cancellationCutoffHours: number;
  refundOnCancelWithinCutoff: boolean;
  clubHouseSections?: ClubHouseSectionSetting[] | null; // null/absent = ordre adaptatif par défaut
  clubHouseKioskSeconds?: number; // auto-défilement du kiosque « À la une » (s) ; 0 = manuel ; absent = 6
  clubSports: ClubSportPublic[];
}

export interface MemberSubscription {
  id: string;                    // id de la Subscription (pour renew/change/cancel)
  planId: string;
  planName: string;
  expiresAt: string;             // ISO
  monthlyPriceSnapshot: string;  // Decimal sérialisé (tarif figé du membre)
  sportKeys: string[];
}

export interface Member {
  id: string;          // id de l'adhésion (ClubMembership)
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  isSubscriber: boolean;
  membershipNo: string | null;
  status: 'ACTIVE' | 'BLOCKED';
  note: string | null;
  watch?: boolean;     // drapeau « à surveiller »
  staffRole?: 'OWNER' | 'ADMIN' | 'STAFF' | null; // rôle back-office (table ClubMember), null = membre simple
  isCoach?: boolean;   // anime des cours (table coaches, liée au compte)
  since?: string;
  // --- enrichissements liste (additifs, cf. listMembers) ---
  avatarUrl?: string | null;
  level?: UserLevel | null;              // niveau padel (null si pas de rating / système désactivé)
  hasActiveSubscription?: boolean;
  subscriptionPlan?: string | null;      // nom de la formule d'abonnement club active
  subscription?: MemberSubscription | null; // abo actif complet (cycle de vie sur la ligne, contexte abonnés)
  hasActivePackage?: boolean;            // carnet / porte-monnaie encore utilisable
  lastSeenAt?: string | null;            // dernière réservation confirmée passée (ISO), null si aucune
}

export interface MemberNote {
  id: string;
  body: string;
  createdAt: string;
  author: { firstName: string; lastName: string } | null;
}

// Passif d'un joueur dans un club (admin) — montants en strings décimales ("36.00").
export interface MemberHistoryReservation {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  type: 'COURT' | 'COACHING' | 'TOURNAMENT' | 'EVENT';
  startTime: string;
  endTime: string;
  cancelledAt: string | null;
  lateCancel: boolean;
  resourceName: string;
  sportKey: string | null;
  isOrganizer: boolean;
  attributedAmount: string;
}

export interface MemberHistory {
  member: {
    userId: string; firstName: string; lastName: string; email: string;
    phone: string | null; avatarUrl: string | null;
    isSubscriber: boolean; membershipNo: string | null;
    status: 'ACTIVE' | 'BLOCKED'; watch: boolean; hasActivePackage: boolean; since: string;
  };
  reservations: MemberHistoryReservation[];
  counts: { total: number; confirmed: number; cancelled: number; lateCancelled: number; noShow: number; upcoming: number };
  heatmap: number[][];
  favorites: { resource: { name: string; count: number } | null; sportKey: string | null; weekday: number | null };
  finance: {
    totalSpent: string; averageBasket: string; outstanding: string;
    paymentsByMethod: Record<string, string>;
    revenueByMonth: Array<{ month: string; net: string }>;
    prepaid: {
      balances: Array<{
        id: string; kind: 'ENTRIES' | 'WALLET'; name: string;
        creditsRemaining: number | null; amountRemaining: string | null;
        purchasedAt: string; expiresAt: string | null;
      }>;
      consumption: Array<{ at: string; method: string; amount: string; packageName: string }>;
    };
  };
  game: {
    sportKey: string;
    level: number | null; tier: string | null; isProvisional: boolean; matchesPlayed: number;
    levelPoints: RatingPoint[];
    wins: number; losses: number;
    frequentPartners: Array<{ userId: string; firstName: string; lastName: string; count: number }>;
  };
  loyalty: {
    firstVisitAt: string | null; lastVisitAt: string | null; daysSinceLastVisit: number | null;
    tenureDays: number; playsPerMonth: number; cancellationRate: number; atRisk: boolean;
  };
}

export interface PlayerMembership {
  clubId: string;
  slug: string;
  isSubscriber: boolean;
  status: 'ACTIVE' | 'BLOCKED';
  club: ClubSummary;
}

export type CreateMemberBody = { firstName: string; lastName: string; email: string; phone?: string; membershipNo?: string };
export type UpdateMemberBody = Partial<{ isSubscriber: boolean; membershipNo: string | null; status: 'ACTIVE' | 'BLOCKED'; note: string | null; phone: string | null }>;

// Plages d'heures creuses par jour (weekday Luxon 1=lundi..7=dimanche), plusieurs
// plages possibles par jour, précision à la minute. Hors plage (ou jour absent) = heures pleines.
export type OffPeakRange = { start: number; startMin?: number; end: number; endMin?: number };
export type OffPeakHours = Record<number, Array<OffPeakRange>>;

export interface PublicResource {
  id: string;
  name: string;
  attributes: { surface?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean } & Record<string, unknown>;
  price: string;
  offPeakPrice: string | null;
  openHour: number;
  closeHour: number;
  club: { slug: string; name: string; timezone: string; status: string; accentColor: string };
  clubSport: { durationsMin: number[]; sport: { name: string; resourceNoun: string; defaultDurationsMin: number[] } };
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  available: boolean;
  price: string;    // prix du créneau (tarif creux si entièrement en heures creuses)
  offPeak: boolean; // true si le créneau est ENTIÈREMENT en heures creuses
}

export interface ClubAvailability {
  resource: {
    id: string;
    name: string;
    attributes: { surface?: string; format?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean } & Record<string, unknown>;
    price: string;
    offPeakPrice: string | null;
    sport: { key: string; name: string };
    clubSportId: string;
  };
  slots: TimeSlot[];
}

export interface ReservationParticipant {
  id: string;
  userId: string;
  isOrganizer: boolean;
  share: string;
}

export interface Reservation {
  id: string;
  resourceId: string;
  userId: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  visibility?: 'PRIVATE' | 'PUBLIC';
  totalPrice: string;
  createdAt: string;
  participants?: ReservationParticipant[];
}

/** Réponse de DELETE /reservations/:id — Reservation + remboursements auto effectués. */
export interface CancelledWithRefund extends Reservation {
  refunded?: Array<{ paymentId: string; amount: string; method: PaymentMethod }>;
}

export interface HoldParams {
  resourceId: string;
  startTime: string;
  endTime: string;
  partnerUserIds?: string[];
  visibility?: 'PRIVATE' | 'PUBLIC';
  targetLevelMin?: number | null;
  targetLevelMax?: number | null;
}

/** Place ciblée au moment de rejoindre une partie ouverte (tap sur une place libre). */
export type JoinTarget = { team: 1 | 2; slot: number };

export interface OpenMatchPlayer {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  isOrganizer: boolean;
  level?: UserLevel | null;
  team?: 1 | 2 | null;
  slot?: number | null; // place au sein de l'équipe (0=G, 1=D), concrète en padel
}

export interface OpenMatch {
  id: string;
  resourceName: string;
  startTime: string;
  endTime: string;
  maxPlayers: number;
  spotsLeft: number;
  full: boolean;
  viewerIsParticipant: boolean;
  viewerIsOrganizer: boolean;
  players: OpenMatchPlayer[];
  targetLevelMin?: number | null;
  targetLevelMax?: number | null;
  competitive?: boolean; // Amicale (false) / Compétitive (true) ; défaut true si absent
  lastMessageAt: string | null;
  sport?: { key: string; name: string }; // toujours peuplé par le backend (parties padel)
  unreadCount: number;
  messageCount: number; // total de messages non supprimés (affiché sur « Discuter »)
  cardVersion?: string; // hash d'état de la carte OG — versionne l'URL de partage (?s=) et l'og:image
}

export interface OpenMatchMessage {
  id: string;
  author: { userId: string; firstName: string; lastName: string; avatarUrl: string | null };
  body: string;
  createdAt: string;
  deleted: boolean;
  edited: boolean;
}

export interface MatchAlert {
  id: string;
  windowStart: string; // ISO UTC
  windowEnd: string;   // ISO UTC
  targetLevelMin: number | null; // fourchette de niveau optionnelle (null = « à mon niveau »)
  targetLevelMax: number | null;
}

export interface CreateClubBody {
  name: string;
  slug?: string;
  address?: string;
  city?: string;
  timezone?: string;
}

export interface RegisterBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  preferredSportId?: string;
}

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; firstName: string; lastName: string; isSuperAdmin: boolean };
}

// Réponse d'inscription : aucun token, le compte attend la validation par code email.
export interface RegisterPending {
  pendingVerification: true;
  email: string;
  devCode?: string; // présent uniquement en dev (sans SMTP)
}

export interface ClubAdminDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  address: string;
  city: string | null;
  country: string | null;
  timezone: string;
  logoUrl: string | null;
  logoWideUrl: string | null;
  logoWideDarkUrl: string | null;
  coverImageUrl: string | null;
  accentColor: string;
  defaultThemeMode: string;
  status: string;
  listedInDirectory: boolean;
  listTournamentsNationally: boolean;
  showOffersPublicly: boolean;
  publicBookingDays: number;
  memberBookingDays: number;
  bookingReleaseMode: BookingReleaseMode;
  publicReleaseHour: number;
  memberReleaseHour: number;
  offPeakHours: OffPeakHours | null;
  bookingQuotas: BookingQuotas | null;
  playerChangeCutoffHours: number;
  cancellationCutoffHours: number;
  showOtherClubsReservations: boolean;
  refundOnCancelWithinCutoff: boolean;
  stripeAccountId: string | null;
  stripeAccountStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'RESTRICTED';
  requireOnlinePayment: boolean;
  requireCardFingerprint: boolean;
  quickPaymentMethods: PaymentMethod[];
  payAtClubOnly?: boolean;
  clubHouseSections?: ClubHouseSectionSetting[] | null;
  clubHouseKioskSeconds?: number;
  levelSystemEnabled: boolean;
  legalEntityName: string | null;
  legalForm: string | null;
  siret: string | null;
  vatNumber: string | null;
  legalRepresentative: string | null;
  legalEmail: string | null;
  legalPhone: string | null;
}

/** Statut d'avancement du paramétrage (guide de démarrage), dérivé de l'état réel. */
export interface OnboardingStatus {
  hasLogo: boolean;
  sportsCount: number;
  resourcesCount: number;
  hasPresentation: boolean;
  stripeStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'RESTRICTED';
  offersCount: number;
  eventsCount: number;
}

// --- Contenu club (pages légales/offres + FAQ) ---

export type ClubPageKind = 'CGV' | 'MENTIONS_LEGALES' | 'CONFIDENTIALITE' | 'OFFRES';

export interface PublicClubPage {
  kind: ClubPageKind;
  bodyMarkdown: string;
  updatedAt: string;
}

export interface FaqEntry { id: string; category: string; question: string; answer: string }
export interface PublicClubFaq {
  socle: FaqEntry[];
  custom: { id: string; category: string | null; question: string; answer: string }[];
}

export interface AdminClubPage {
  kind: ClubPageKind;
  bodyMarkdown: string;
  published: boolean;
  source: 'TEMPLATE' | 'CUSTOM';
  updatedAt: string;
}

export interface AdminFaqItem {
  id: string;
  question: string;
  answerMarkdown: string;
  category: string | null;
  sortOrder: number;
  published: boolean;
}

export type PutPageBody = { bodyMarkdown: string; published?: boolean };
export type FaqItemBody = Partial<{ question: string; answerMarkdown: string; category: string | null; published: boolean }>;

// Quotas de réservations COURT par joueur (réglage club, null = désactivé).
// UPCOMING = résas à venir simultanées ; WEEKLY = semaine calendaire lun-dim.
// Limite null = illimité, 0 = bloqué.
export interface QuotaLimits { peak: number | null; offPeak: number | null }
export interface BookingQuotas {
  model: 'UPCOMING' | 'WEEKLY';
  subscriber: QuotaLimits;
  nonSubscriber: QuotaLimits;
}

// État du quota du joueur (compteur « 3/5 »). Une classe à null = illimitée (non affichée) ;
// l'objet entier est null si le club n'a pas de quotas ou si toutes les limites sont illimitées.
export interface QuotaCount { used: number; limit: number }
export interface MyQuotaStatus {
  model: 'UPCOMING' | 'WEEKLY';
  peak: QuotaCount | null;
  offPeak: QuotaCount | null;
}

export type UpdateClubBody = Partial<{
  name: string;
  description: string;
  address: string;
  city: string;
  timezone: string;
  logoUrl: string;
  coverImageUrl: string | null;
  accentColor: string;
  defaultThemeMode: string;
  listedInDirectory: boolean;
  listTournamentsNationally: boolean;
  showOffersPublicly: boolean;
  publicBookingDays: number;
  memberBookingDays: number;
  bookingReleaseMode: BookingReleaseMode;
  publicReleaseHour: number;
  memberReleaseHour: number;
  offPeakHours: OffPeakHours | null;
  bookingQuotas: BookingQuotas | null;
  playerChangeCutoffHours: number;
  cancellationCutoffHours: number;
  showOtherClubsReservations: boolean;
  refundOnCancelWithinCutoff: boolean;
  requireOnlinePayment: boolean;
  requireCardFingerprint: boolean;
  quickPaymentMethods: PaymentMethod[];
  payAtClubOnly: boolean;
  clubHouseSections: ClubHouseSectionSetting[] | null;
  clubHouseKioskSeconds: number;
  levelSystemEnabled: boolean;
  legalEntityName: string;
  legalForm: string;
  siret: string;
  vatNumber: string;
  legalRepresentative: string;
  legalEmail: string;
  legalPhone: string;
}>;

// --- Types back-office ---

export interface AdminClubSport {
  id: string;
  slotStepMin: number | null;
  durationsMin: number[];
  sport: { id: string; key: string; name: string; resourceNoun: string; defaultDurationsMin: number[]; surfaces: string[]; hasLighting: boolean };
}

export interface AdminResource {
  id: string;
  name: string;
  attributes: { surface?: string; format?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean } & Record<string, unknown>;
  isActive: boolean;
  price: string;
  offPeakPrice: string | null;
  openHour: number;
  closeHour: number;
  slotStepMin: number | null;
  clubSport: { id: string; slotStepMin: number | null; durationsMin: number[]; sport: { key: string; name: string; resourceNoun: string; defaultSlotStepMin: number; defaultDurationsMin: number[]; surfaces: string[]; hasLighting: boolean } };
}

export interface CreateResourceBody {
  clubSportId: string;
  name: string;
  attributes?: Record<string, unknown>;
  price: number;
  offPeakPrice?: number | null;
  openHour?: number;
  closeHour?: number;
  slotStepMin?: number | null;
}

export type UpdateResourceBody = Partial<Omit<CreateResourceBody, 'clubSportId'>>;

export interface AdminReservationFilters {
  date?: string;
  resourceId?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
}

export interface CreateReservationBody {
  resourceId: string;
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:mm
  endTime: string;    // HH:mm
  type: ReservationType;
  title?: string;
  memberUserId?: string;
  price?: number;
  // Cours (Lot 2) — paramètres optionnels si type=COACHING
  lessonParams?: { coachId: string; capacity: number; lessonKind: 'INDIVIDUAL' | 'COLLECTIVE'; allowSelfEnroll: boolean };
}

export interface RescheduleReservationBody {
  resourceId: string;
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:mm
  endTime: string;    // HH:mm
}

export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE' | 'OTHER' | 'VOUCHER' | 'CHEQUE' | 'CLUB' | 'PACK_CREDIT' | 'WALLET' | 'MEMBER' | 'SUBSCRIPTION';
export type PackageKind = 'ENTRIES' | 'WALLET';
export type VoucherStatus = 'PENDING_REIMBURSEMENT' | 'REIMBURSED';

export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

export interface Payment {
  id: string;
  amount: string;
  method: PaymentMethod;
  /** Joueur (participant) auquel le paiement est attribué ; null = réservation entière / place anonyme. */
  participantId?: string | null;
  payerName: string | null;
  note: string | null;
  voucherRef: string | null;
  voucherIssuer: string | null;
  voucherStatus: VoucherStatus | null;
  createdAt: string;
  /** Statut du paiement (présent depuis la feature payments-foundations). */
  status?: PaymentStatus;
  /** Montant déjà remboursé, string décimale (ex. "13.00"). */
  refundedAmount?: string;
  /** Numéro de reçu séquentiel, null si non encore attribué. */
  receiptNo?: number | null;
}

export interface Refund {
  id: string;
  paymentId: string;
  clubId: string;
  /** Montant remboursé, string décimale (ex. "13.00") — l'API sérialise le Decimal Prisma. */
  amount: string;
  reason: string | null;
  method: PaymentMethod;
  createdAt: string;
}

export interface AddPaymentBody {
  amount: number;
  method?: PaymentMethod;
  payerName?: string;
  note?: string;
  sourcePackageId?: string;
  voucherRef?: string;
  voucherIssuer?: string;
  participantId?: string; // attribue l'encaissement à un joueur précis de la résa
}

export type SubscriptionBenefit = 'INCLUDED' | 'DISCOUNT';
export type SubscriptionStatus = 'ACTIVE' | 'CANCELLED';

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sportKeys: string[];
  monthlyPrice: string;        // Decimal sérialisé
  commitmentMonths: number;
  offPeakOnly: boolean;
  benefit: SubscriptionBenefit;
  discountPercent: number | null;
  dailyCap: number | null;
  weeklyCap: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface Subscription {
  id: string;
  planId: string;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt: string;
  monthlyPriceSnapshot: string;
  sportKeys: string[];
  offPeakOnly: boolean;
  benefit: SubscriptionBenefit;
  discountPercent: number | null;
  dailyCap: number | null;
  weeklyCap: number | null;
  plan: { name: string };
}

export type CreateSubscriptionPlanBody = {
  name: string; description?: string | null; sportKeys: string[]; monthlyPrice: number; commitmentMonths: number;
  offPeakOnly?: boolean; benefit: SubscriptionBenefit; discountPercent?: number | null;
  dailyCap?: number | null; weeklyCap?: number | null;
};
export type UpdateSubscriptionPlanBody = Partial<CreateSubscriptionPlanBody & { isActive: boolean; imageUrl: string | null }>;
export interface SellSubscriptionBody {
  planId: string; method?: PaymentMethod; payerName?: string; voucherRef?: string; voucherIssuer?: string;
}

// --- Pilotage /admin/abonnes ---
export interface SubscriberRow {
  id: string;
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt: string;
  monthlyPriceSnapshot: string;
  sportKeys: string[];
}
export interface SubscriptionPlanSummary {
  id: string; name: string; monthlyPrice: string; benefit: SubscriptionBenefit;
  discountPercent: number | null; sportKeys: string[]; isActive: boolean; activeCount: number;
}
export interface SubscriptionOverview {
  kpis: { activeCount: number; monthlyRevenueCents: number; expiringSoonCount: number };
  plans: SubscriptionPlanSummary[];
  subscribers: SubscriberRow[];
}
export interface RenewSubscriptionBody { method?: PaymentMethod; payerName?: string; voucherRef?: string; voucherIssuer?: string; }
export interface ChangeSubscriptionBody extends RenewSubscriptionBody { planId: string; }

export interface PackageTemplate {
  id: string;
  kind: PackageKind;
  name: string;
  sportKeys: string[];
  description: string | null;
  imageUrl: string | null;
  price: string;
  entriesCount: number | null;
  walletAmount: string | null;
  validityDays: number | null;
  isActive: boolean;
  createdAt: string;
  /** Pouls de ventes (agrégat serveur). Absent des vieux payloads → optionnel. */
  stats?: { soldCount: number; activeCount: number; outstandingAmount: string };
}

export interface MemberPackage {
  id: string;
  kind: PackageKind;
  creditsTotal: number | null;
  creditsRemaining: number | null;
  amountTotal: string | null;
  amountRemaining: string | null;
  purchasedAt: string;
  expiresAt: string | null;
  template: { name: string; sportKeys: string[] };
}

/** Solde actif renvoyé par l'endpoint de masse — porte en plus le userId du joueur. */
export type ActiveMemberPackage = MemberPackage & { userId: string };

export interface MyPaymentMethod {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

export interface MyPayment {
  id: string;
  date: string;            // ISO
  amountCents: number;
  refundedCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  label: string;
}

export interface AccountDeletionSummary {
  blockingClubs: string[];
  futureReservations: number;
  activeSubscriptions: number;
  balances: string[];
}

export interface CaissePayment extends Payment {
  reservation: {
    id: string; startTime: string;
    resource: { name: string };
    user: { firstName: string; lastName: string } | null;
  } | null;
  memberPackage: {
    id: string; kind: PackageKind;
    user: { firstName: string; lastName: string };
    template: { name: string };
  } | null;
}

export interface CaisseSummary {
  date: string;
  totalsByMethod: Partial<Record<PaymentMethod, string>>;
  collected: string;
  payments: CaissePayment[];
}

export interface MonthlySummary {
  year: number;
  month: number;
  totalsByMethod: Record<string, string>;
  collected: string;
  refunded: string;
  byDay: { date: string; net: string }[];
}

export interface SellPackageBody {
  templateId: string;
  method?: PaymentMethod;
  payerName?: string;
  voucherRef?: string;
  voucherIssuer?: string;
}

// Recharge d'un solde existant (top-up encaissé) : entrées OU montant selon le kind du solde.
export interface RechargePackageBody {
  addEntries?: number; price?: number; addAmount?: number;
  method?: PaymentMethod; payerName?: string; voucherRef?: string; voucherIssuer?: string;
}
// Correction d'un solde (valeur cible, sans argent) — motif obligatoire (journalisé).
export interface AdjustPackageBody { newCredits?: number; newAmount?: number; reason: string }

export type CreatePackageTemplateBody = {
  kind: PackageKind; name: string; description?: string | null; price: number;
  entriesCount?: number; walletAmount?: number; validityDays?: number | null; sportKeys?: string[];
};
export type UpdatePackageTemplateBody = Partial<{
  name: string; description: string | null; imageUrl: string | null; price: number;
  validityDays: number | null; isActive: boolean; sportKeys: string[];
  entriesCount: number; walletAmount: number;
}>;

export type AnnouncementKind = 'INFO' | 'OFFER' | 'TOURNAMENT' | 'EVENT';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  imageUrl: string | null;
  kind: AnnouncementKind;
  validUntil: string | null;
  isPublished: boolean;
  pinned: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClubPhoto { id: string; url: string; caption: string | null; sortOrder: number; }

export interface ClubPresentation {
  presentationText: string | null;
  coverImageUrl: string | null;
  address: string; city: string | null;
  latitude: number | null; longitude: number | null;
  contactPhone: string | null; contactEmail: string | null;
  openingHoursText: string | null;
  foundedYear: number | null;
  amenities: string[];
  photos: ClubPhoto[];
}

export interface PublicPlan {
  id: string; name: string; description: string | null; imageUrl: string | null; monthlyPrice: string; commitmentMonths: number;
  offPeakOnly: boolean; benefit: 'INCLUDED' | 'DISCOUNT'; discountPercent: number | null;
  dailyCap: number | null; weeklyCap: number | null; sportKeys: string[];
}
export interface PublicPackageTemplate {
  id: string; name: string; sportKeys: string[]; description: string | null; imageUrl: string | null; kind: 'ENTRIES' | 'WALLET'; price: string;
  entriesCount: number | null; walletAmount: string | null; validityDays: number | null;
}
export interface PublicOffers { plans: PublicPlan[]; packages: PublicPackageTemplate[]; onlinePurchase: boolean; }

export interface TopMonthEntry { userId: string; firstName: string; lastName: string; avatarUrl: string | null; wins: number; }

export interface Sponsor {
  id: string;
  name: string;
  logoUrl: string;
  linkUrl: string | null;
  offerText: string | null;
  offerCode: string | null;
  offerUntil: string | null;
  pinned: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export type AnnouncementBody = Partial<{ title: string; body: string; linkUrl: string | null; imageUrl: string | null; isPublished: boolean; pinned: boolean; kind: AnnouncementKind; validUntil: string | null; }>;
export type SponsorBody = Partial<{ name: string; logoUrl: string; linkUrl: string | null; sortOrder: number; isActive: boolean; offerText: string; offerCode: string; offerUntil: string; pinned: boolean; }>;

export type ReservationType = 'COURT' | 'COACHING' | 'TOURNAMENT' | 'EVENT';

export interface ParticipantBill {
  id: string;
  userId: string;
  isOrganizer: boolean;
  firstName: string;
  lastName: string;
  share: string;        // part due de ce joueur
  paid: string;         // déjà encaissé pour ce joueur
  outstanding: string;  // reste dû
}

export interface ClubReservation {
  id: string;
  resourceId: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  type: ReservationType;
  title: string | null;
  totalPrice: string;
  paidAmount: string;
  dueAmount: string;  // dû calculé par le backend (prix ou tarif prorata) — source de vérité
  resource: { id: string; name: string };
  user: { id: string; firstName: string; lastName: string; email: string } | null;
  payments: Payment[];
  participants: ParticipantBill[];
  hasCardFingerprint?: boolean;
  seriesId?: string | null;
  lesson?: { id: string; capacity: number; lessonKind: 'INDIVIDUAL' | 'COLLECTIVE'; coach: { name: string; photoUrl: string | null } } | null;
  /** présent seulement sur la réponse d'une association « créer un membre à la volée puis associer ». */
  createdMember?: { userId: string; tempPassword: string | null; existed: boolean } | null;
}

export interface ClubReservationsResponse {
  reservations: ClubReservation[];
  summary: { total: string; paid: string; paidTotal: string; outstanding: string };
}

export type SSEEventType = 'slot_held' | 'slot_confirmed' | 'slot_released' | 'connected';

export interface SSEEvent {
  type: SSEEventType;
  resourceId: string;
  reservationId?: string;
  startTime?: string;
  endTime?: string;
  expiresAt?: string;
}

// --- Types tournois ---

export type TournamentGender = 'MEN' | 'WOMEN' | 'MIXED';
export type TournamentStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export type RegistrationStatus = 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
export type Sex = 'MALE' | 'FEMALE';

/**
 * Présent dans la réponse de `registerTournament`/`registerEvent`.
 * null = épreuve gratuite → flux habituel.
 * non-null → parcours Stripe : 'payment' = place confirmée, 'setup' = liste d'attente.
 */
export type RegistrationPaymentInfo = { mode: 'payment' | 'setup' } | null;

export interface Tournament {
  id: string;
  clubId: string;
  clubSportId: string;
  name: string;
  category: string;
  gender: TournamentGender;
  openToWomen: boolean; // Messieurs uniquement : true = tableau "open" (femmes admises), false = 100% hommes
  description: string | null;
  contactInfo: string | null;
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
  maxTeams: number | null;
  entryFee: string | null;
  requirePrepayment?: boolean; // true = inscription à régler en ligne via Stripe
  status: TournamentStatus;
  confirmedCount: number;
  waitlistCount: number;
  sport?: { key: string; name: string } | null; // peuplé par les listes (club / national / mes tournois) ; le détail garde clubSport
}

/** Projection club renvoyée par le calendrier national (publique, sans données privées). */
export interface NationalTournamentClub {
  slug: string;
  name: string;
  city: string | null;
  department: string | null;
  departmentCode: string | null;
  timezone: string;
  accentColor: string;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Un tournoi du calendrier national = tournoi public + son club. */
export interface NationalTournament extends Tournament {
  club: NationalTournamentClub;
}

/** Projection club d'une partie ouverte de la vitrine palova.fr (publique). */
export interface NationalOpenMatchClub {
  slug: string;
  name: string;
  city: string | null;
  timezone: string;
  accentColor: string;
  logoUrl: string | null;
}

/** Partie ouverte agrégée sur la vitrine palova.fr : partie publique + son club. */
export interface NationalOpenMatch {
  id: string;
  resourceName: string;
  sport: { key: string; name: string };
  startTime: string;
  endTime: string;
  maxPlayers: number;
  spotsLeft: number;
  full: boolean;
  targetLevelMin: number | null;
  targetLevelMax: number | null;
  competitive?: boolean;
  players: OpenMatchPlayer[];
  club: NationalOpenMatchClub;
}

export interface TournamentDetail extends Tournament {
  club: { slug: string; name: string; timezone: string };
  clubSport: { sport: { key: string; name: string } };
}

export interface TournamentRegistrationRecord {
  id: string;
  tournamentId: string;
  captainUserId: string;
  partnerUserId: string;
  status: RegistrationStatus;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TournamentParticipant {
  id: string;
  status: RegistrationStatus;
  captain: { firstName: string; lastName: string; avatarUrl: string | null };
  partner: { firstName: string; lastName: string; avatarUrl: string | null };
  captainLevel?: UserLevel | null;
  partnerLevel?: UserLevel | null;
  // Additifs (messagerie 1-à-1) : cibles du bouton « Envoyer un message ».
  captainUserId?: string;
  partnerUserId?: string;
}

export interface MyTournamentRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  captain: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  partner: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  captainLicense: string | null;
  partnerLicense: string | null;
  tournament: Tournament & { club: { slug: string; name: string; timezone: string } };
}

export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  sex: Sex | null;
  birthDate: string | null;
  avatarUrl: string | null;
  locale: string | null;
  isSuperAdmin: boolean;
  showInLeaderboard: boolean;
  autoMatchProposals: boolean;
  acceptsFriendRequests: boolean;
  acceptsDirectMessages: boolean;
  preferredSport: { id: string; key: string; name: string } | null;
}

export interface MyRating {
  calibrated: boolean;
  level: number | null; // null tant que le joueur n'a pas de niveau (onboarding neutre)
  tier: string;
  isProvisional: boolean;
  reliability: number; // % de fiabilité (dérivé du RD, façon Pista)
  matchesPlayed: number;
}

export interface UserLevel { level: number; tier: string; isProvisional: boolean; reliability: number; }
export interface RatingPoint { playedAt: string; level: number; }

// --- Override admin du niveau (fiche membre) ---
// Une correction manuelle de niveau, mise à plat pour la fiche admin (récent d'abord).
export interface LevelAdjustment {
  id: string;
  previousLevel: number | null;
  newLevel: number;
  reason: string | null;
  createdAt: string;
  staffFirstName: string;
  staffLastName: string;
  sportKey: string;
  sportName: string;
}

// Payload de la fiche niveau admin : niveaux courants par sport (clé = sportKey) + historique.
export interface AdminMemberLevel {
  levels: Record<string, UserLevel>;
  history: LevelAdjustment[];
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level: number;
  tier: string;
  matchesPlayed: number;
}

export interface LeaderboardMe {
  optedIn: boolean;
  ranked: boolean;
  rank: number | null;
  level: number | null;
  matchesPlayed: number;
  matchesToGo: number;
  wins: number;
  losses: number;
  streak: number; // signé : +N victoires d'affilée, -N défaites, 0 aucune
}

export interface ClubLeaderboard {
  sport: string;
  entries: LeaderboardEntry[];
  me: LeaderboardMe;
}

export interface ClubMatchStats { wins: number; losses: number; streak: number; }

export interface ClubMemberSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  level?: UserLevel | null;
  iFollow?: boolean;   // annoté par searchMembers
  mutual?: boolean;
  friend?: FriendRelation; // annoté par searchMembers
}

export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level?: UserLevel | null;
  mutual: boolean;
  playedTogetherCount?: number;
  lastPlayedTogetherAt?: string | null;
}

export interface FollowRelation {
  iFollow: boolean;
  followsMe: boolean;
  mutual: boolean;
}

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';
export interface FriendRelation {
  status: FriendStatus;
  requestable: boolean;
}
export interface FriendRequests {
  received: Friend[];
  sent: Friend[];
}

// --- Hub social « Mes amis » ---
export interface FriendsAgendaItem {
  kind: 'match' | 'tournament' | 'event';
  id: string;
  startTime: string;
  endTime: string | null;
  label: string;
  friends: { id: string; firstName: string; lastName: string; avatarUrl: string | null }[];
}
export interface PlayerSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level: UserLevel | null;
  lastPlayedAt: string;
  playedCount: number;
  requestable: boolean;
}

// --- Messagerie privée 1-à-1 ---
export interface DmUserInfo { userId: string; firstName: string; lastName: string; avatarUrl: string | null }
export interface DmReaction { emoji: string; userIds: string[] }
export interface DmMessage {
  id: string; author: DmUserInfo; body: string; imageUrl: string | null;
  createdAt: string; deleted: boolean; edited: boolean; reactions: DmReaction[];
}
export interface DmMeta { myLastReadAt: string | null; otherLastReadAt: string | null; blocked: boolean; hasMore: boolean }
export interface ConversationSummary {
  id: string; other: DmUserInfo; clubId: string | null; lastMessageAt: string | null;
  unreadCount: number;
  lastMessage: { body: string; hasImage: boolean; mine: boolean; deleted: boolean } | null;
}

export type ReportReason = 'HARASSMENT' | 'ILLEGAL' | 'SPAM' | 'OTHER';
export type ReportStatus = 'OPEN' | 'RESOLVED';
export type ReportResolution = 'DELETED' | 'REJECTED';

export interface MessageReportRow {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: ReportResolution | null;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { id: string; firstName: string; lastName: string };
  message: {
    id: string; body: string; deleted: boolean; createdAt: string;
    author: { id: string; firstName: string; lastName: string };
    hasImage?: boolean;
  };
  match?: { reservationId: string; startTime: string; resourceName: string };
  conversationId?: string;
}

export interface MyClubMembership {
  membershipNo: string | null;
  status: 'ACTIVE' | 'BLOCKED';
  isSubscriber: boolean;
}

export interface AdminRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  captain: { id: string; firstName: string; lastName: string; email: string; phone: string | null; sex: Sex | null };
  partner: { id: string; firstName: string; lastName: string; email: string; phone: string | null; sex: Sex | null };
  captainLicense: string | null;
  partnerLicense: string | null;
}

export interface AdminTournamentDetail {
  tournament: Tournament;
  registrations: AdminRegistration[];
}

export type CreateTournamentBody = {
  clubSportId: string;
  name: string;
  category: string;
  gender: TournamentGender;
  openToWomen?: boolean;
  description?: string | null;
  contactInfo?: string | null;
  startTime: string;
  endTime?: string | null;
  registrationDeadline: string;
  maxTeams?: number | null;
  entryFee?: number | null;
  requirePrepayment?: boolean;
};
export type UpdateTournamentBody = Partial<CreateTournamentBody & { status: TournamentStatus }>;

// --- Events (animations : mêlées, stages, soirées…) ---

export type ClubEventKind = 'MELEE' | 'STAGE' | 'SOIREE' | 'INITIATION' | 'AUTRE';
export type ClubEventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';

export interface ClubEvent {
  id: string;
  clubId: string;
  name: string;
  kind: ClubEventKind;
  description: string | null;
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
  capacity: number | null;
  price: string | null;            // Decimal sérialisé
  requirePrepayment?: boolean;     // true = inscription à régler en ligne via Stripe
  memberOnly: boolean;
  status: ClubEventStatus;
  confirmedCount: number;
  waitlistCount: number;
  clubSportId?: string | null;
  sport?: { key: string; name: string } | null; // peuplé par les listes/détail events + mes events
}

export interface ClubEventDetail extends ClubEvent {
  club: { slug: string; name: string; timezone: string };
}

export interface EventRegistrationRecord {
  id: string;
  eventId: string;
  userId: string;
  status: RegistrationStatus;
}

export interface EventParticipant {
  id: string;
  status: RegistrationStatus;
  user: { firstName: string; lastName: string; avatarUrl: string | null };
  level?: UserLevel | null;
  // Additif (messagerie 1-à-1) : cible du bouton « Envoyer un message ».
  userId?: string;
}

export interface MyEventRegistration {
  id: string;
  status: RegistrationStatus;
  event: ClubEvent & { club: { slug: string; name: string; timezone: string } };
}

export interface AdminEventRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
}

export interface AdminEventDetail {
  event: ClubEvent;
  registrations: AdminEventRegistration[];
}

export type CreateEventBody = {
  name: string;
  kind: ClubEventKind;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  registrationDeadline: string;
  capacity?: number | null;
  price?: number | null;
  memberOnly?: boolean;
  clubSportId?: string | null;
  requirePrepayment?: boolean;
};
export type UpdateEventBody = Partial<CreateEventBody & { status: ClubEventStatus }>;

export interface PlatformStats {
  clubs: { total: number; active: number; suspended: number };
  users: number;
  reservations: number;
  tournaments: number;
  billing: { mrrCents: number; byTier: number[]; toRegularize: number; pastDue: number };
}

// --- Abonnement Palova du club (facturation SaaS, offre au membre actif) ---

export type BillingState = 'EXEMPT' | 'FREE' | 'OK' | 'TO_REGULARIZE' | 'PAST_DUE';

export interface ClubBillingSubscription {
  status: string;
  tier: number;
  tierLabel: string;
  interval: 'month' | 'year';
  priceCents: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface ClubBilling {
  activeMembers: number;
  countedAt: string | null;
  observedTier: number;
  tierLabel: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  state: BillingState;
  subscription: ClubBillingSubscription | null;
  snapshots: { month: string; activeMembers: number; tier: number }[];
}

export interface PlatformClubSubscriptionSummary {
  status: string;
  tier: number;
  interval: 'month' | 'year';
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface PlatformClubBilling {
  activeMembers: number;
  observedTier: number;
  state: BillingState;
  exempt: boolean;
  subscribedTier: number | null;
  subscription?: PlatformClubSubscriptionSummary | null;
}

export interface PlatformClub {
  id: string;
  slug: string;
  aliases: string[];
  name: string;
  city: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  owners: { id: string; email: string; firstName: string; lastName: string }[];
  counts: { adherents: number; resources: number };
  billing: PlatformClubBilling;
}

// --- Fiche club détaillée + facturation superadmin (v2) ---

export interface PlatformInvoiceRow {
  id: string;
  stripeInvoiceId: string;
  amountCents: number;
  currency: string;
  status: string; // 'paid' | 'open' | 'failed' | 'void' | 'uncollectible'
  tier: number | null;
  interval: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  createdAt: string;
}

export interface PlatformClubDetail {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  address: string;
  timezone: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  aliases: string[];
  owners: { id: string; email: string; firstName: string; lastName: string }[];
  counts: { adherents: number; resources: number; tournaments: number; events: number };
  billing: {
    exempt: boolean;
    activeMembers: number;
    countedAt: string | null;
    observedTier: number;
    state: BillingState;
    subscription: {
      status: string; tier: number; interval: 'month' | 'year'; priceCents: number;
      currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
    } | null;
    snapshots: { month: string; activeMembers: number; tier: number }[];
    invoices: PlatformInvoiceRow[];
  };
  activity: {
    reservationsByMonth: { month: string; count: number }[];
    reservations30d: number;
    lastReservationAt: string | null;
  };
}

export interface PlatformBillingOverview {
  mrrCents: number;
  toRegularize: number;
  pastDue: number;
  byTierObserved: number[];
  byTierSubscribed: number[];
  revenueByMonth: { month: string; amountCents: number }[];
  totalCollectedCents: number;
  invoiceCount: number;
}

export interface PlatformClubActivity {
  clubId: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  activeMembers: number;
  reservations30d: number;
  lastReservationAt: string | null;
}

export interface PlatformUsageStats {
  months: string[];
  growth: { newClubs: number[]; newUsers: number[]; reservations: number[] };
  activity: PlatformClubActivity[];
}

export interface CreateClubByPlatformBody {
  club: { name: string; city?: string; timezone?: string; sportKey?: string };
  owner: { firstName: string; lastName: string; email: string; password: string };
}

// --- Coachs ---

export interface LessonStudent {
  id: string;
  status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  waitlistPosition: number | null;
  /** présent seulement sur la réponse d'une inscription « créer un membre à la volée puis inscrire ». */
  createdMember?: { userId: string; tempPassword: string | null; existed: boolean } | null;
}

export interface Coach {
  id: string;
  clubId: string;
  name: string;
  photoUrl: string | null;
  isActive: boolean;
  sortOrder: number;
}

// --- Séries de réservations ---

export interface CreateSeriesBody {
  resourceId: string;
  type: ReservationType;
  title?: string;
  weekday: number;       // 1–7 (1=lundi)
  startLocal: string;    // "HH:mm"
  durationMin: number;
  startDate: string;     // "YYYY-MM-DD"
  endDate: string;       // "YYYY-MM-DD"
  // Cours (Lot 2)
  coachId?: string;
  capacity?: number;
  lessonKind?: 'INDIVIDUAL' | 'COLLECTIVE';
  allowSelfEnroll?: boolean;
  enrollmentMode?: 'SERIES' | 'PER_SESSION';
}

export interface CreateSeriesResult {
  seriesId: string;
  created: number;
  skipped: Array<{ start: string; reason: string }>;
}

// --- Cours joueur (Lot 3) ---

export interface LessonSummary {
  id: string;
  clubId: string;
  lessonKind: 'INDIVIDUAL' | 'COLLECTIVE';
  allowSelfEnroll: boolean;
  capacity: number;
  confirmedCount: number;
  waitlistCount: number;
  seriesId: string | null;
  coach: { name: string; photoUrl: string | null };
  reservation: { startTime: string; endTime: string; resource: { name: string } };
  sport?: { key: string; name: string } | null;
  series?: { enrollmentMode: 'SERIES' | 'PER_SESSION'; title: string | null } | null;
}

export type LessonDetail = LessonSummary & { club: { slug: string; name: string; timezone: string } };

export interface LessonParticipant {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  waitlistPosition: number | null;
}

export interface LessonEnrollmentRecord {
  id: string;
  status: string;
  lessonId: string | null;
  seriesId: string | null;
}

/** Shape retournée par /api/me/lessons : LessonSummary enrichie du club (pour dayKey tz-aware). */
export type MyLessonSummary = LessonSummary & {
  club: { slug: string; name: string; timezone: string };
};

export interface MyLessonEnrollment {
  enrollmentId: string;
  status: string;
  lesson: MyLessonSummary;
}

// --- Espace coach (Mes cours) ---

export interface CoachStudentRow {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  waitlistPosition: number | null;
}

export interface CoachLessonRow {
  id: string;
  lessonKind: string;
  seriesId: string | null;
  reservation: { startTime: string; endTime: string; resource: { name: string } };
  sport: { key: string; name: string } | null;
  series: { title: string | null; enrollmentMode: string | null } | null;
  capacity: number;
  confirmedCount: number;
  waitlistCount: number;
  students: CoachStudentRow[];
}

// Construit l'URL du flux SSE de notifications (utilisé par la cloche).
export function notificationsStreamUrl(token: string): string {
  return `${BASE_URL}/api/me/notifications/stream?token=${encodeURIComponent(token)}`;
}

/** URL du flux SSE du chat d'une partie (token en query : EventSource ne pose pas d'en-tête). */
export function chatStreamUrl(slug: string, id: string, token: string): string {
  return `${BASE_URL}/api/clubs/${slug}/open-matches/${id}/chat/stream?token=${encodeURIComponent(token)}`;
}

/** URL du flux SSE d'une conversation privée (token en query : EventSource ne pose pas d'en-tête). */
export function conversationStreamUrl(conversationId: string, token: string): string {
  return `${BASE_URL}/api/conversations/${conversationId}/stream?token=${encodeURIComponent(token)}`;
}

/** URL de la photo d'un message privé (streaming authentifié — les <img> ne posent pas d'Authorization). */
export function dmImageUrl(conversationId: string, messageId: string, token: string): string {
  return `${BASE_URL}/api/conversations/${conversationId}/messages/${messageId}/image?token=${encodeURIComponent(token)}`;
}
