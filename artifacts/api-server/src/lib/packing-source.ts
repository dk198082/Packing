import { getAzurePool } from "@workspace/db/azure";
import { getCarrierForwarderDescription } from "./carrier-forwarder-reasons";

export type PackingDataSource = "salesorderheaderv3staging";

export type PackingOrder = {
  id: string;
  team: "PARTS" | "SYSTEM";
  salesOrder: string;
  isRetailOrder: boolean;
  customer: string;
  productDescription: string;
  machineModel: string;
  confirmedShipDate: string;
  requestedShipDate: string;
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
  createdDate: string;
  sourceModifiedAt: string;
  doNotProcess: boolean;
  doNotProcessKnown: boolean;
};

export type PackingOrdersResult = {
  source: PackingDataSource;
  fetchedAt: string;
  skippedRows: number;
  orders: PackingOrder[];
};

const PACKING_SOURCE = "salesorderheaderv3staging" as const;
const SALES_ORDER_TYPE = 3;
const OPEN_ORDER_STATUS = 1;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getSchema() {
  const schema = process.env.AZURE_PG_SCHEMA?.trim();
  if (!schema || !IDENTIFIER.test(schema)) {
    throw new Error("AZURE_PG_SCHEMA must be a valid PostgreSQL identifier.");
  }
  return schema;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sourceQuery() {
  const table = `${quoteIdentifier(getSchema())}.${quoteIdentifier(PACKING_SOURCE)}`;
  return `
    SELECT *
    FROM ${table}
    WHERE "dataareaid" = 'TOUS'
      AND "salesorderpoolid" IN ('Parts', 'System')
      AND "inpacking" = 1
      AND "salestype" = ${SALES_ORDER_TYPE}
      AND "salesorderstatus" = ${OPEN_ORDER_STATUS}
  `;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function getField(row: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizeKey));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeKey(key))) return value;
  }
  return undefined;
}

function asText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function asDate(value: unknown, includeTime = false) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    return includeTime ? value.toISOString() : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return "";
  return includeTime ? text.replace(" ", "T") : text.slice(0, 10);
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) {
    return value === 1;
  }
  const text = asText(value).toLowerCase();
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return undefined;
}

function asDocumentStatus(value: unknown) {
  const text = asText(value);
  const code = Number(text);
  if (!text || !Number.isInteger(code)) return text;
  if (code === 1 || code === 7) return "Confirmation";
  if (code === 2) return "Picking list";
  if (code === 3 || code === 4) return "Packing slip";
  if (code === 5 || code === 6) return "Invoice";
  return "None";
}

function parseTeam(value: unknown): PackingOrder["team"] | undefined {
  const pool = asText(value).toLowerCase();
  if (pool.includes("system")) return "SYSTEM";
  if (pool.includes("part")) return "PARTS";
  return undefined;
}

function parseRetailOrder(value: unknown): boolean {
  const retailChannel = asText(value).toLowerCase();
  return Boolean(retailChannel) && !["0", "false", "no", "n"].includes(retailChannel);
}

function normalizeRow(row: Record<string, unknown>): PackingOrder | undefined {
  const salesOrder = asText(
    getField(row, ["Sales order", "salesordernumber", "salesorder"]),
  );
  const team = parseTeam(getField(row, ["Pool", "salesorderpoolid", "pool"]));

  if (!salesOrder || !team) return undefined;

  const machineType = asText(
    getField(row, ["Machine Type", "tomachinetype", "machinetype"]),
  );

  return {
    id: salesOrder,
    team,
    salesOrder,
    isRetailOrder: parseRetailOrder(
      getField(row, ["Retail Channel Table", "retailchanneltable"]),
    ),
    customer: asText(
      getField(row, ["Customer name", "customername", "salesordername"]),
    ),
    productDescription: team === "PARTS" ? machineType : "",
    machineModel: team === "SYSTEM" ? machineType : "",
    confirmedShipDate: asDate(
      getField(row, [
        "Confirmed ship date",
        "confirmedshipdate",
        "confirmedshippingdate",
      ]),
    ),
    requestedShipDate: asDate(
      getField(row, ["Requested ship date", "requestedshippingdate"]),
    ),
    customerPO: asText(
      getField(row, [
        "Customer PO number",
        "customerponumber",
        "customerpo",
        "customerrequisitionnumber",
      ]),
    ),
    modeOfDelivery: asText(
      getField(row, ["Mode of delivery", "deliverymodecode", "modeofdelivery"]),
    ),
    incoterms: asText(
      getField(row, ["Delivery terms", "deliverytermscode", "incoterms"]),
    ),
    namedPlace: asText(
      getField(row, ["Named Place", "namedplace", "exportreason"]),
    ),
    carrierForwarder: asText(
      getField(row, [
        "Carrier/Forwarder",
        "shippingcarrierid",
        "carrierforwarder",
        "deliveryreasoncode",
      ]),
    ),
    carrierForwarderDescription: getCarrierForwarderDescription(
      asText(
        getField(row, [
          "Carrier/Forwarder",
          "shippingcarrierid",
          "carrierforwarder",
          "deliveryreasoncode",
        ]),
      ),
    ),
    customerCarrierAccount: asText(
      getField(row, [
        "Cust Carrier Account",
        "tocarrieraccount",
        "shippingcarriercustomeraccountnumber",
      ]),
    ),
    shippingInstructions: asText(
      getField(row, ["Engineering Notes", "shippinginstructions"]),
    ),
    freightInformation: asText(getField(row, ["freightinformation"])),
    documentStatus: asDocumentStatus(
      getField(row, [
        "Document Status",
        "documentstatus",
        "salesorderprocessingstatus",
      ]),
    ),
    salesperson: asText(
      getField(row, ["Name", "salesperson", "delcontactname"]),
    ),
    country: asText(
      getField(row, [
        "Country/region",
        "deliveryaddresscountryregionid",
        "deliveryaddresscountryregionisocode",
        "country",
      ]),
    ),
    deliveryCity: asText(
      getField(row, ["Delivery City", "deliveryaddresscity"]),
    ),
    deliveryState: asText(
      getField(row, ["Delivery State", "deliveryaddressstateid"]),
    ),
    customerReference: asText(
      getField(row, ["Customer reference", "customersorderreference"]),
    ),
    createdDate: asDate(
      getField(row, ["Created date and time", "ordercreationdatetime"]),
      true,
    ),
    sourceModifiedAt: asDate(
      getField(row, ["TO modified date and time", "tomodifieddatetime"]),
      true,
    ),
    doNotProcess:
      parseBoolean(
        getField(row, [
          "Do not process",
          "donotprocess",
          "issalesprocessingstopped",
        ]),
      ) === true ||
      parseBoolean(getField(row, ["MCR Order Stopped", "mcrorderstopped"])) ===
        true,
    doNotProcessKnown:
      parseBoolean(
        getField(row, [
          "Do not process",
          "donotprocess",
          "issalesprocessingstopped",
        ]),
      ) !== undefined ||
      parseBoolean(getField(row, ["MCR Order Stopped", "mcrorderstopped"])) !==
        undefined,
  };
}

function normalizeRows(rows: Record<string, unknown>[]) {
  const orders = new Map<string, PackingOrder>();
  let skippedRows = 0;

  for (const row of rows) {
    const inPacking = getField(row, ["In Packing", "inpacking"]);
    if (inPacking !== undefined && parseBoolean(inPacking) !== true) continue;

    const order = normalizeRow(row);
    if (!order) {
      skippedRows += 1;
      continue;
    }

    if (!orders.has(order.id)) orders.set(order.id, order);
  }

  return { orders: [...orders.values()], skippedRows };
}

async function querySource() {
  const result = await getAzurePool().query<Record<string, unknown>>(
    sourceQuery(),
  );
  return normalizeRows(result.rows);
}

export async function getPackingOrders(): Promise<PackingOrdersResult> {
  const result = await querySource();
  return {
    source: PACKING_SOURCE,
    fetchedAt: new Date().toISOString(),
    ...result,
  };
}