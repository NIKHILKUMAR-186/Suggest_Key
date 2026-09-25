/**
 * PostgREST relationship hints (foreign key names).
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * PostgREST refuses to embed a related table when MORE THAN ONE foreign key
 * exists between the two tables. The request fails with:
 *
 *   PGRST201: "Could not embed because more than one relationship was found
 *              for 'mentor_applications' and 'profiles'"
 *
 * Audited against the live database schema (verified through the PostgREST
 * introspection endpoint on the configured Supabase project):
 *
 *   mentor_applications.user_id      -> profiles.id  (mentor_applications_user_id_fkey)
 *   mentor_applications.reviewed_by  -> profiles.id  (mentor_applications_reviewed_by_fkey)
 *
 * Both foreign keys point at public.profiles, so every embed of `profiles`
 * from `mentor_applications` MUST name the intended foreign key explicitly.
 * The applicant identity shown on the Mentor Verification page always comes
 * from the `user_id` relationship - never from `reviewed_by` (that is the
 * reviewing admin).
 *
 * Tables in this project that have TWO foreign keys to public.profiles (and
 * therefore must always use an explicit relationship hint when embedding
 * profiles):
 *
 *   bookings                -> mentor_id, seeker_id
 *   mentor_applications     -> user_id, reviewed_by
 *   payments                -> seeker_id, verified_by
 *   session_workspaces      -> mentor_id, seeker_id
 *   slot_holds              -> mentor_id, seeker_id
 */
export const POSTGREST_RELATIONSHIPS = {
  /** mentor_applications.user_id -> profiles.id (the APPLICANT / mentor user) */
  mentorApplicationApplicant: 'mentor_applications_user_id_fkey',
  /** mentor_applications.reviewed_by -> profiles.id (the REVIEWING ADMIN) */
  mentorApplicationReviewer: 'mentor_applications_reviewed_by_fkey',
  /** mentor_application_audit.admin_user_id -> profiles.id */
  mentorApplicationAuditAdmin: 'mentor_application_audit_admin_user_id_fkey',
  /** mentor_verification_documents.reviewed_by -> profiles.id */
  mentorDocumentReviewer: 'mentor_verification_documents_reviewed_by_fkey',
} as const;

export type PostgrestRelationship =
  (typeof POSTGREST_RELATIONSHIPS)[keyof typeof POSTGREST_RELATIONSHIPS];

/**
 * Builds an explicit embed expression such as
 * `profile:profiles!mentor_applications_user_id_fkey(id, full_name)`.
 */
export function embedWithRelationship(
  alias: string,
  table: string,
  relationship: PostgrestRelationship,
  columns = '*',
): string {
  return `${alias}:${table}!${relationship}(${columns})`;
}
