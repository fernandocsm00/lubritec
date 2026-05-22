export type {
  CampaignStatus,
  CampaignRecipientStatus,
  AudienceFilters,
  CampaignDryRunResponse,
  PublicCampaign,
  CampaignFunnel,
  CampaignsAggregateStats,
  CampaignsTimeseries,
  CampaignsTimeseriesBucket,
  TopCampaign,
  TopCampaignsResponse,
  PublicCampaignRecipient,
  LeadStatus,
  LeadSource,
  LossReason,
  CampaignHsmVariable,
} from '@shared/types';

import type { PublicCampaign, CampaignFunnel } from '@shared/types';

export interface PublicCampaignWithFunnel extends PublicCampaign {
  funnel: CampaignFunnel;
}
