import { useEffect, useState } from 'react';
import type { Order } from '@/lib/types';
import { formatCardDate, formatWorkDaysInPacking } from '@/lib/order-logic';
import {
  BOX_NUMBER_OPTIONS,
  CUSTOM_BOX_NUMBER,
  getBoxOptionLabel,
  getOperatorFields,
  normalizePickId,
  saveOperatorFields,
  type BoxDimensions,
  type OperatorFields,
} from '@/lib/operator-fields';
import {
  getPrintableBoxes,
  getPrintablePickIds,
  hasIncompletePickIds,
  printDymo30336Labels,
} from '@/lib/print-label';
import { X, FileText, Plus, Printer, Pencil } from 'lucide-react';

interface OrderDrawerProps {
  order: Order | null;
  onClose: () => void;
  onPackStartedChange: (orderId: string, packStartedAt: string | null) => Promise<string | null>;
  canEditPackStatus: boolean;
  now: Date;
}

const EMPTY_OPERATOR_FIELDS: OperatorFields = {
  boxes: [{ boxNumber: '', weightLbs: '', dimensions: { length: '', width: '', height: '' } }],
  pickIds: ['IPR'],
  packStartedAt: null,
};

export function OrderDrawer({
  order,
  onClose,
  onPackStartedChange,
  canEditPackStatus,
  now,
}: OrderDrawerProps) {
  const [fields, setFields] = useState<OperatorFields>(EMPTY_OPERATOR_FIELDS);
  const [printError, setPrintError] = useState('');
  const [packStatusError, setPackStatusError] = useState('');
  const [isSavingPackStatus, setIsSavingPackStatus] = useState(false);
  const [isEditingPackStart, setIsEditingPackStart] = useState(false);
  const [packStartDraft, setPackStartDraft] = useState('');

  useEffect(() => {
    setFields(order
      ? { ...getOperatorFields(order.id), packStartedAt: order.packStartedAt }
      : EMPTY_OPERATOR_FIELDS);
    setPrintError('');
    setPackStatusError('');
    setIsEditingPackStart(false);
    setPackStartDraft('');
  }, [order?.id, order?.packStartedAt]);

  if (!order) return null;

  const updateFields = (patch: Partial<OperatorFields>) => {
    setFields((prev) => {
      const next = { ...prev, ...patch };
      saveOperatorFields(order.id, next);
      return next;
    });
  };

  const savePackStartedAt = async (packStartedAt: string | null): Promise<boolean> => {
    const previousPackStartedAt = fields.packStartedAt;
    setPackStatusError('');
    setIsSavingPackStatus(true);
    setFields((previous) => ({ ...previous, packStartedAt }));

    try {
      const savedPackStartedAt = await onPackStartedChange(order.id, packStartedAt);
      setFields((previous) => ({ ...previous, packStartedAt: savedPackStartedAt }));
      return true;
    } catch {
      setFields((previous) => ({ ...previous, packStartedAt: previousPackStartedAt }));
      setPackStatusError('Pack status could not be saved. Please try again.');
      return false;
    } finally {
      setIsSavingPackStatus(false);
    }
  };

  const handleStartPack = () => {
    if (!canEditPackStatus || fields.packStartedAt || isSavingPackStatus) return;
    void savePackStartedAt(new Date().toISOString());
  };

  const handleEditPackStart = () => {
    if (!canEditPackStatus || !fields.packStartedAt) return;
    const date = new Date(fields.packStartedAt);
    const timezoneOffset = date.getTimezoneOffset();
    setPackStartDraft(new Date(date.getTime() - timezoneOffset * 60_000).toISOString().slice(0, 16));
    setIsEditingPackStart(true);
  };

  const handleSavePackStart = () => {
    if (!canEditPackStatus) return;
    const date = new Date(packStartDraft);
    if (Number.isNaN(date.getTime()) || isSavingPackStatus) return;
    void savePackStartedAt(date.toISOString()).then((saved) => {
      if (saved) setIsEditingPackStart(false);
    });
  };

  const handleCancelPackStartEdit = () => {
    setIsEditingPackStart(false);
    setPackStartDraft('');
  };

  const handleResetPackStatus = () => {
    if (!canEditPackStatus || isSavingPackStatus) return;
    void savePackStartedAt(null).then((saved) => {
      if (saved) handleCancelPackStartEdit();
    });
  };

  const addPickId = () => {
    if (fields.pickIds.length >= 3) return;
    updateFields({ pickIds: [...fields.pickIds, 'IPR'] });
  };

  const updatePickId = (index: number, value: string) => {
    const next = [...fields.pickIds];
    next[index] = normalizePickId(value);
    updateFields({ pickIds: next });
  };

  const removePickId = (index: number) => {
    updateFields({ pickIds: fields.pickIds.filter((_, i) => i !== index) });
  };

  const addBox = () => {
    if (fields.boxes.length >= BOX_NUMBER_OPTIONS.length) return;
    updateFields({
      boxes: [
        ...fields.boxes,
        { boxNumber: '', weightLbs: '', dimensions: { length: '', width: '', height: '' } },
      ],
    });
  };

  const updateBox = (index: number, patch: Partial<OperatorFields['boxes'][number]>) => {
    const next = fields.boxes.map((box, boxIndex) => (
      boxIndex === index ? { ...box, ...patch } : box
    ));
    updateFields({ boxes: next });
  };

  const removeBox = (index: number) => {
    const next = fields.boxes.filter((_, i) => i !== index);
    updateFields({
      boxes: next.length > 0
        ? next
        : [{ boxNumber: '', weightLbs: '', dimensions: { length: '', width: '', height: '' } }],
    });
  };

  const updateBoxDimensions = (
    index: number,
    dimension: keyof BoxDimensions,
    value: string,
  ) => {
    const box = fields.boxes[index];
    if (!box) return;
    updateBox(index, {
      dimensions: {
        ...box.dimensions,
        [dimension]: value,
      },
    });
  };

  const printablePickIds = getPrintablePickIds(fields.pickIds);
  const hasInvalidPickIds = hasIncompletePickIds(fields.pickIds);
  const printableBoxes = getPrintableBoxes(fields.boxes);

  const packStartedLabel = fields.packStartedAt
    ? new Date(fields.packStartedAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const handlePrintLabel = () => {
    void printDymo30336Labels(order, fields.pickIds, fields.boxes).then((result) => {
      if (result.ok) {
        setPrintError('');
        return;
      }

      const messages = {
        NO_PICK_IDS: 'Each IPR must contain exactly 6 digits before printing.',
        NO_BOXES: 'Enter at least one Box # or weight before printing.',
        POPUP_BLOCKED: 'Allow pop-ups for this site, then try again.',
        QRCODE_ERROR: 'The QR code could not be generated. Please try again.',
      };
      setPrintError(messages[result.reason]);
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full min-w-0 overflow-x-hidden md:w-[400px] md:min-w-[400px] xl:w-[420px] xl:min-w-[420px] bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300 font-sans">
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-base font-bold text-primary tracking-wide">
            ORDER DETAILS
          </h2>
          <button onClick={onClose} aria-label="Close order details" className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto p-4 flex flex-col gap-5 custom-scrollbar">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-foreground mb-0.5 tracking-tight">{order.salesOrder}</h1>
              {order.team === 'SYSTEM' && (
                <div className="truncate text-sm font-semibold text-foreground">
                  {order.machineModel || '—'}
                </div>
              )}
              <div className="text-primary text-lg font-medium truncate">{order.customer}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground tracking-wide mb-0.5">Confirmed Ship Date</div>
              <div className="font-mono text-base font-bold text-foreground">
                {formatCardDate(order.confirmedShipDate)}
              </div>
               <div className="mt-2 text-[10px] text-muted-foreground tracking-wide">In Packing [Work Days]</div>
               <div className="whitespace-nowrap font-mono text-xs font-bold text-primary">
                 {formatWorkDaysInPacking(order.inPackingAt, now)}
               </div>
            </div>
          </div>
          
             <div className="grid grid-cols-2 border-y border-border py-3">
             <div className="pr-2">
                 <div className="font-semibold text-foreground text-sm truncate flex items-center gap-1" title={order.modeOfDelivery}>
                   <FileText className="w-3 h-3 shrink-0" /> {order.modeOfDelivery || '—'}
                 </div>
               <div className="text-[10px] text-muted-foreground tracking-wide mt-1">Mode of Delivery</div>
            </div>
             <div className="border-l border-border pl-2 pr-2">
                 <div className="font-semibold text-foreground text-sm">{order.incoterms || '—'}</div>
               <div className="text-[10px] text-muted-foreground tracking-wide mt-1">Incoterms</div>
            </div>
          </div>
          
            <div className="flex flex-col gap-2.5 text-sm">
             <DetailRow label="Carrier / Forwarder" value={order.carrierForwarderDescription || order.carrierForwarder} />
              <DetailRow
                label="Delivery Location"
                value={[order.deliveryCity, order.deliveryState, order.country].filter(Boolean).join(', ')}
              />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-[10px] font-bold tracking-wider text-muted-foreground">OPERATOR ENTRY</h3>

            {order.team === 'SYSTEM' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-primary/40 bg-primary/5 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold tracking-wider text-muted-foreground">PACK STATUS</div>
                  {packStartedLabel ? (
                    isEditingPackStart ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="datetime-local"
                          value={packStartDraft}
                          onChange={(event) => setPackStartDraft(event.target.value)}
                          aria-label="Pack start date and time"
                          className="pack-start-datetime min-w-0 rounded-sm border border-border bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          type="button"
                          onClick={handleSavePackStart}
                          disabled={isSavingPackStatus}
                          className="rounded-sm bg-primary px-2 py-1 text-[10px] font-bold uppercase text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelPackStartEdit}
                          disabled={isSavingPackStatus}
                          className="rounded-sm border border-border px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleResetPackStatus}
                          disabled={isSavingPackStatus}
                          className="rounded-sm border border-destructive/50 px-2 py-1 text-[10px] font-bold uppercase text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Reset status
                        </button>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate text-sm font-semibold text-primary">Started {packStartedLabel}</div>
                        {canEditPackStatus && (
                          <button
                            type="button"
                            onClick={handleEditPackStart}
                            className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground hover:text-primary"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        )}
                      </div>
                    )
                  ) : (
                    <div className="text-xs text-muted-foreground">Not started</div>
                  )}
                </div>
                {canEditPackStatus && !packStartedLabel && !isEditingPackStart && (
                  <button
                    type="button"
                    onClick={handleStartPack}
                    disabled={isSavingPackStatus}
                    className="shrink-0 rounded-sm bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                     Start pack
                  </button>
                )}
                {!canEditPackStatus && (
                  <div className="basis-full text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Viewer access · status is read-only
                  </div>
                )}
                {packStatusError && (
                  <div className="basis-full text-[10px] font-medium text-destructive" role="alert">
                    {packStatusError}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-muted-foreground tracking-wide">Packaging</label>
                {fields.boxes.length < BOX_NUMBER_OPTIONS.length && (
                  <button
                    type="button"
                    onClick={addBox}
                    className="text-[10px] text-primary font-semibold flex items-center gap-1 hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Add Box
                  </button>
                )}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_88px_24px] gap-2 text-[10px] text-muted-foreground tracking-wide">
                 <span>DIMENSIONS (IN)</span>
                <span>WEIGHT (LBS)</span>
                <span />
              </div>
              {fields.boxes.map((box, index) => (
                <div key={index} className="flex items-start gap-2">
                  {box.boxNumber === CUSTOM_BOX_NUMBER ? (
                    <div className="min-w-0 flex-1">
                      <div className="grid grid-cols-3 gap-1">
                        {(['length', 'width', 'height'] as const).map((dimension) => (
                          <label key={dimension} className="flex items-center border border-border rounded-sm bg-background overflow-hidden focus-within:ring-1 focus-within:ring-primary">
                            <span className="px-1.5 text-[10px] font-semibold text-primary border-r border-border bg-muted/30 uppercase">
                              {dimension[0]}
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="1"
                              value={box.dimensions[dimension]}
                              onChange={(e) => updateBoxDimensions(index, dimension, e.target.value)}
                              aria-label={`${dimension} for custom box ${index + 1}`}
                              placeholder="0"
                              className="min-w-0 w-full bg-transparent px-1.5 py-1.5 text-sm text-foreground focus:outline-none"
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateBox(index, {
                          boxNumber: '',
                          dimensions: { length: '', width: '', height: '' },
                        })}
                        className="mt-1 text-[9px] text-muted-foreground hover:text-primary hover:underline"
                      >
                        Use box list
                      </button>
                    </div>
                  ) : (
                    <select
                      id={`box-number-${index}`}
                      value={box.boxNumber}
                      onChange={(e) => updateBox(index, {
                        boxNumber: e.target.value,
                        dimensions: e.target.value === CUSTOM_BOX_NUMBER
                          ? box.dimensions
                          : { length: '', width: '', height: '' },
                      })}
                       aria-label={`Dimensions (in) ${index + 1}`}
                      className="min-w-0 flex-1 bg-background border border-border rounded-sm px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value={CUSTOM_BOX_NUMBER}>Custom</option>
                      <option value="">Select…</option>
                      {BOX_NUMBER_OPTIONS.map((boxNumber) => (
                        <option key={boxNumber} value={boxNumber}>{getBoxOptionLabel(boxNumber)}</option>
                      ))}
                    </select>
                  )}
                  <input
                    id={`weight-lbs-${index}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={box.weightLbs}
                    onChange={(e) => updateBox(index, { weightLbs: e.target.value })}
                    placeholder="0.0"
                    aria-label={`Weight (lbs) for Box # ${index + 1}`}
                    className="w-[88px] bg-background border border-border rounded-sm px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => removeBox(index)}
                       aria-label={`Remove Dimensions (in) ${index + 1}`}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {index === 0 && <span aria-hidden="true" className="w-[24px] shrink-0" />}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-muted-foreground tracking-wide">Pick IDs</label>
                {fields.pickIds.length < 3 && (
                  <button
                    type="button"
                    onClick={addPickId}
                    className="text-[10px] text-primary font-semibold flex items-center gap-1 hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                )}
              </div>
              {fields.pickIds.map((pickId, index) => (
                  <div key={index} className="flex items-center gap-2">
                      <div className="min-w-0 flex flex-1 items-center bg-background border border-border rounded-sm overflow-hidden focus-within:ring-1 focus-within:ring-primary">
                      <span className="px-2 py-1.5 text-sm font-semibold text-primary border-r border-border bg-muted/30" aria-hidden="true">IPR</span>
                    <input
                      type="text"
                      value={pickId.replace(/^IPR/, '')}
                      onChange={(e) => updatePickId(index, e.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                       minLength={6}
                      maxLength={6}
                      aria-label={`Pick ID ${index + 1} numeric suffix`}
                      placeholder="6 digits"
                      className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground focus:outline-none"
                    />
                    </div>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => removePickId(index)}
                        aria-label={`Remove pick ID ${index + 1}`}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {index === 0 && <span aria-hidden="true" className="w-[24px] shrink-0" />}
                  </div>
                ))}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-border bg-muted/30">
          {printError && (
            <p className="mb-2 text-[11px] font-medium text-destructive" role="alert">
              {printError}
            </p>
          )}
          <button
            type="button"
            onClick={handlePrintLabel}
            disabled={hasInvalidPickIds || printablePickIds.length === 0 || printableBoxes.length === 0}
            title={
              hasInvalidPickIds || printablePickIds.length === 0
                ? 'Enter exactly 6 digits in each IPR before printing'
                : printableBoxes.length === 0
                  ? 'Enter at least one Box # or weight before printing'
                  : 'Print one DYMO 30336 label per box'
            }
            className="w-full py-3 border border-primary text-primary font-bold tracking-widest text-sm hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2 rounded-sm group disabled:cursor-not-allowed disabled:border-muted-foreground/40 disabled:text-muted-foreground disabled:hover:bg-transparent"
          >
            PRINT LABEL <Printer className="w-3.5 h-3.5 group-hover:scale-105 transition-transform" />
          </button>
          <div className="mt-1.5 text-center text-[9px] font-mono text-muted-foreground">
            DYMO 30336 · 2⅛″ × 1″ · QR CODE
          </div>
        </div>
      </div>
    </>
  );
}

function DetailRow({ label, value, isMono, isDestructive }: { label: string, value: string, isMono?: boolean, isDestructive?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <div className="col-span-2 text-muted-foreground text-[10px] tracking-wide pt-0.5 leading-tight">{label}</div>
      <div className={`col-span-3 text-foreground ${isMono ? 'font-mono text-xs' : ''} ${isDestructive ? 'text-destructive font-bold' : ''}`}>
        {value || '-'}
      </div>
    </div>
  );
}
