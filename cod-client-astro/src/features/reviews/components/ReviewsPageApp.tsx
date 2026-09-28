import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Filter as FilterIcon, MoreHorizontal, Star, Trash2, X, XCircle } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { deleteReview, listReviews, updateReviewStatus } from "@/features/reviews/api";
import { buildReviewsUrl, formatReviewDate, parseReviewStatus, reviewErrorMessage } from "@/features/reviews/model";
import type { Review, ReviewListResult, ReviewStatus } from "@/features/reviews/types";
import {
  Alert,
  Badge,
  DropdownItem,
  DropdownMenu,
  EmptyState,
  PageHeader,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirmDialog,
} from "@/components/ui";

const LIMIT = 20;
const FILTERS: Array<ReviewStatus | "all"> = ["all", "pending", "approved", "rejected"];

function StarRating({ rating }: { rating: number }) {
  return <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={14} className={star <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"} />)}</span>;
}

function ReviewSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="grid h-14 grid-cols-[1.2fr_1fr_0.8fr_2fr_0.8fr] items-center gap-4 rounded-xl border border-border px-4">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
          <span className="h-6 w-20 justify-self-end animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const t = useT("reviews");
  const tone = status === "approved" ? "success" : status === "rejected" ? "critical" : "warning";
  return <Badge tone={tone}>{t(`status_${status}`)}</Badge>;
}

function ReviewRowActions({ review, canManage, busyKey, onApprove, onReject, onDelete }: { review: Review; canManage: boolean; busyKey: string | null; onApprove: () => void; onReject: () => void; onDelete: () => void }) {
  const t = useT("reviews");
  const common = useT("common");
  if (!canManage) return null;
  return (
    <DropdownMenu
      trigger={<MoreHorizontal size={16} />}
      triggerLabel={`${common("table.actions")}: ${review.customerName}`}
    >
      {review.status !== "approved" && (
        <DropdownItem disabled={busyKey === `status-${review.id}`} onClick={onApprove}>
          <CheckCircle size={14} />
          {t("action_approve")}
        </DropdownItem>
      )}
      {review.status !== "rejected" && (
        <DropdownItem disabled={busyKey === `status-${review.id}`} onClick={onReject}>
          <XCircle size={14} />
          {t("action_reject")}
        </DropdownItem>
      )}
      <DropdownItem disabled={busyKey === `delete-${review.id}`} onClick={onDelete} danger>
        <Trash2 size={14} />
        {t("action_delete")}
      </DropdownItem>
    </DropdownMenu>
  );
}

function ReviewDesktopRow({ review, canManage, busyKey, onApprove, onReject, onDelete }: { review: Review; canManage: boolean; busyKey: string | null; onApprove: () => void; onReject: () => void; onDelete: () => void }) {
  const locale = useLocale();
  return (
    <TableRow className={`border-b border-border last:border-0 transition-colors hover:bg-muted/40 ${review.status === "pending" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{review.customerName.trim().charAt(0).toUpperCase()}</span>
          <p className="max-w-36 truncate font-medium text-foreground">{review.customerName}</p>
        </div>
      </TableCell>
      <TableCell>
        <p className="max-w-40 truncate text-sm font-medium text-foreground">{review.productName ?? "—"}</p>
        <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">{review.orderNumber}</p>
      </TableCell>
      <TableCell>
        <StarRating rating={review.rating} />
      </TableCell>
      <TableCell>
        {review.title && <p className="max-w-56 truncate text-sm font-medium text-foreground">{review.title}</p>}
        <p className={`max-w-56 text-xs leading-5 text-muted-foreground ${review.title ? "line-clamp-1" : "line-clamp-2"}`}>{review.body}</p>
      </TableCell>
      <TableCell>
        <StatusBadge status={review.status} />
      </TableCell>
      <TableCell>
        <span className="whitespace-nowrap text-xs text-muted-foreground">{formatReviewDate(review.createdAt, locale)}</span>
      </TableCell>
      <TableCell className="text-end">
        <ReviewRowActions review={review} canManage={canManage} busyKey={busyKey} onApprove={onApprove} onReject={onReject} onDelete={onDelete} />
      </TableCell>
    </TableRow>
  );
}

function ReviewMobileCard({ review, canManage, busyKey, onApprove, onReject, onDelete }: { review: Review; canManage: boolean; busyKey: string | null; onApprove: () => void; onReject: () => void; onDelete: () => void }) {
  const locale = useLocale();
  const t = useT("reviews");
  return (
    <article className={`p-4 ${review.status === "pending" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{review.customerName}</p>
            <StatusBadge status={review.status} />
          </div>
          <div className="mt-1"><StarRating rating={review.rating} /></div>
        </div>
        <ReviewRowActions review={review} canManage={canManage} busyKey={busyKey} onApprove={onApprove} onReject={onReject} onDelete={onDelete} />
      </div>
      {review.title && <p className="mt-2 truncate text-sm font-medium text-foreground">{review.title}</p>}
      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{review.body}</p>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{review.productName ?? review.orderNumber}</span>
        <span className="shrink-0">{formatReviewDate(review.createdAt, locale)}</span>
      </div>
    </article>
  );
}

function ReviewsList() {
  const t = useT("reviews");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [result, setResult] = useState<ReviewListResult | null>(null);
  const status = parseReviewStatus(new URLSearchParams(window.location.search).get("status") ?? undefined) ?? "all";
  const page = Math.max(1, parseInt(new URLSearchParams(window.location.search).get("page") ?? "1", 10) || 1);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setResult(await listReviews({ status: status === "all" ? undefined : status, limit: LIMIT, offset: (page - 1) * LIMIT }));
    } catch (cause) { setLoadError(cause); }
  }, [status, page]);

  useEffect(() => { if (canScope(identity, SCOPES.REVIEWS_READ)) void load(); }, [load, identity?.role, identity?.scopes.join(",")]);

  if (!canScope(identity, SCOPES.REVIEWS_READ)) return <Alert role="alert" tone="critical">{auth("no_access")}</Alert>;
  if (loadError) return <Alert role="alert" tone="critical"><AlertCircle size={18} className="shrink-0" /><div className="flex-1"><p className="font-semibold">{t("error_load")}</p><button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">{common("retry")}</button></div></Alert>;
  if (result === null) return <ReviewSkeleton />;

  const totalPages = Math.max(1, Math.ceil(result.total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const canManage = canScope(identity, SCOPES.REVIEWS_MANAGE);

  function switchStatus(next: ReviewStatus | "all") {
    window.location.assign(buildReviewsUrl(next, 1));
  }
  function switchPage(next: number) {
    window.location.assign(buildReviewsUrl(status, Math.max(1, Math.min(next, totalPages))));
  }
  async function runStatus(review: Review, nextStatus: ReviewStatus) {
    setBusyKey(`status-${review.id}`); setActionError(null);
    try {
      await updateReviewStatus(review.id, nextStatus);
      await load();
      notify.success(t(nextStatus === "approved" ? "toast_approved" : "toast_rejected"));
    } catch (cause) {
      const message = reviewErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    } finally { setBusyKey(null); }
  }
  async function runDelete(review: Review) {
    if (!await confirm({ title: t("confirm_delete_title"), description: t("confirm_delete_desc").replace("{name}", review.customerName), confirmLabel: t("confirm_delete_label"), tone: "danger" })) return;
    setBusyKey(`delete-${review.id}`); setActionError(null);
    try {
      await deleteReview(review.id);
      await load();
      notify.success(t("toast_deleted"));
    } catch (cause) {
      const message = reviewErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    } finally { setBusyKey(null); }
  }

  return <div className="space-y-3">
    {actionError && <Alert role="alert" tone="critical"><AlertCircle size={18} className="shrink-0" /><span className="flex-1">{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label={common("cancel")}><X size={16} /></button></Alert>}
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-xl border border-primary/10 bg-primary/5 px-3 py-1.5"><Star size={14} className="fill-primary text-primary" /><p className="text-[11px] font-bold uppercase tracking-widest text-primary">{t("total").replace("{n}", String(result.total))}</p>{result.pendingCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{t("new_badge").replace("{n}", String(result.pendingCount))}</span>}</div>
        <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
          <FilterIcon size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <Select aria-label={t("table.status")} value={status} onChange={(event) => switchStatus(event.currentTarget.value as ReviewStatus | "all")} variant="bare" size="sm" wrapperClassName="min-w-0 flex-1" triggerClassName="min-w-0 flex-1">
            {FILTERS.map((filter) => <option key={filter} value={filter}>{t(`filter_${filter}`)}{filter === "pending" && result.pendingCount > 0 ? ` (${result.pendingCount})` : ""}</option>)}
          </Select>
        </label>
      </div>
      {result.rows.length === 0 ? <EmptyState icon={<Star size={22} />} title={t("empty_title")} description={t("empty_desc")} /> : <>
        <div className="divide-y divide-border md:hidden">
          {result.rows.map((review) => <ReviewMobileCard key={review.id} review={review} canManage={canManage} busyKey={busyKey} onApprove={() => void runStatus(review, "approved")} onReject={() => void runStatus(review, "rejected")} onDelete={() => void runDelete(review)} />)}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow className="text-xs font-semibold text-muted-foreground">
                <TableHead className="text-start">{t("table.customer")}</TableHead>
                <TableHead className="text-start">{t("table.product")}</TableHead>
                <TableHead className="text-start">{t("table.rating")}</TableHead>
                <TableHead className="text-start">{t("table.review")}</TableHead>
                <TableHead className="text-start">{t("table.status")}</TableHead>
                <TableHead className="text-start">{t("table.date")}</TableHead>
                <TableHead className="w-12"><span className="sr-only">{common("table.actions")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((review) => (
                <ReviewDesktopRow key={review.id} review={review} canManage={canManage} busyKey={busyKey} onApprove={() => void runStatus(review, "approved")} onReject={() => void runStatus(review, "rejected")} onDelete={() => void runDelete(review)} />
              ))}
            </TableBody>
          </Table>
        </div>
        <Pagination page={safePage} totalPages={totalPages} total={result.total} pageSize={LIMIT} onPageChange={switchPage} />
      </>}
    </div>
  </div>;
}

function Gated() {
  const t = useT("reviews");
  return <DashboardChrome currentPath="/reviews" wide><PageHeader title={t("page_title")} /><ReviewsList /></DashboardChrome>;
}

export default function ReviewsPageApp() { return <RequireAuth><Gated /></RequireAuth>; }
