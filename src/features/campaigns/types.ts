export type {
  CampaignStatus,
  CampaignRecipientStatus,
  AudienceFilters,
  CampaignDryRunResponse,
  PublicCampaign,
  CampaignFunnel,
  PublicCampaignRecipient,
  LeadStatus,
  LeadSource,
  LossReason,
} from '@shared/types';

import type { PublicCampaign, CampaignFunnel } from '@shared/types';

export interface PublicCampaignWithFunnel extends PublicCampaign {
  funnel: CampaignFunnel;
}
