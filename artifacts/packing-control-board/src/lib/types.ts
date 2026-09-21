export type Team = "PARTS" | "SYSTEM";
export type Readiness = "READY" | "ATTENTION" | "HOLD";
export type DateBucket = "OVERDUE" | "DUE_TODAY" | "NEXT_3_DAYS" | "LATER";
export type ViewMode = "CARD" | "TABLE";

export interface Order {
  id: string;
  team: Team;
  salesOrder: string;
  isRetailOrder: boolean;
  customer: string;
  productDescription: string;
  machineModel: string;
  confirmedShipDate: string; // ISO
  requestedShipDate: string; // ISO
  customerPO: string;
  modeOfDelivery: string;
  incoterms: string;
  namedPlace: string;
  carrierForwarder: string;
  carrierForwarderDescription: string;
  customerCarrierAccount: string;
  shippingInstructions: string;
  freightInformation: string;
  documentStatus: string;
  salesperson: string;
  country: string;
  deliveryCity: string;
  deliveryState: string;
  customerReference: string;
  createdDate: string; // ISO
  inPackingAt: string; // ISO
  doNotProcess: boolean;
  doNotProcessKnown: boolean;
  packStartedAt: string | null;
  priority: number | null;
}
