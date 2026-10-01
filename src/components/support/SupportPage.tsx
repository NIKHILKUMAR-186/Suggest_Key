import React from 'react';
import { Info, LifeBuoy } from 'lucide-react';
import { PageHeading } from '@/src/components/booking/PageHeading';
import { InlineNotice, SectionCard } from '@/src/components/booking/StatePanel';
import { SupportForm } from '@/src/components/support/SupportForm';
import { useAuth } from '@/src/context/AuthContext';

/**
 * The one support destination, mounted at `/seeker/support`, `/mentor/support`
 * and `/admin/support`.
 *
 * Seeker and mentor reach it from Settings -> Help & Support (it is not a
 * primary navigation item); admin reaches it from the sidebar. All three render
 * this page, and the role inside the form decides the categories.
 *
 * The wording below is deliberate about scope: this screen SENDS a message. It
 * is not a support inbox, and nothing here reads back a history.
 */
export interface SupportPageProps {
  /**
   * Set when the form is embedded in an existing page that already owns the
   * `<h1>` (for example the Settings tab), so the heading is not duplicated.
   */
  showHeading?: boolean;
}

export const SupportPage: React.FC<SupportPageProps> = ({ showHeading = true }) => {
  const { activeRole } = useAuth();
  const isAdmin = activeRole === 'admin';

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      {showHeading && (
        <PageHeading
          title="Help & Support"
          description="Tell the Suggest Key team what went wrong and we will get back to you."
        />
      )}

      <SectionCard
        title="Send Support Message"
        description="Fields marked with an asterisk are required."
        icon={LifeBuoy}
        aria-label="Send a support message"
      >
        <SupportForm />
      </SectionCard>

      <InlineNotice tone="neutral" icon={Info} title="Where this message goes">
        Your message is emailed to the Suggest Key support team. It is not stored in your Suggest
        Key account, so there is no message history here to read back.
        {isAdmin && (
          <>
            {' '}
            An in-app support ticket queue for the admin console is future work and is not built.
          </>
        )}
      </InlineNotice>
    </div>
  );
};

export default SupportPage;
