import { Badge } from "@/components/ui/badge"
import type {
  CertificateStatus,
  DocumentStatus,
  EvidenceStatus,
  OrderStatus,
  RtoSubmissionStatus,
} from "@/lib/types"

/** Status → badge color. Dimensions stay visually distinct (Spec §5–§6). */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  if (["Completed", "Approved", "Certificate Issued", "Won"].includes(status))
    return <Badge variant="success">{status}</Badge>
  if (["On Hold", "Lost", "Cancelled", "Refunded"].includes(status))
    return <Badge variant="destructive">{status}</Badge>
  if (status === "New" || status === "Lead")
    return <Badge variant="secondary">{status}</Badge>
  return <Badge variant="info">{status}</Badge>
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  if (status === "Approved") return <Badge variant="success">{status}</Badge>
  if (status === "Rejected") return <Badge variant="destructive">{status}</Badge>
  if (status === "Superseded") return <Badge variant="secondary">{status}</Badge>
  if (status === "Under Review") return <Badge variant="warning">{status}</Badge>
  return <Badge variant="outline">{status}</Badge>
}

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  if (status === "Complete") return <Badge variant="success">{status}</Badge>
  if (status === "Additional Evidence Required")
    return <Badge variant="warning">{status}</Badge>
  if (status === "In Progress") return <Badge variant="info">{status}</Badge>
  return <Badge variant="outline">{status}</Badge>
}

export function RtoSubmissionBadge({ status }: { status: RtoSubmissionStatus }) {
  if (status === "Issued" || status === "Acknowledged")
    return <Badge variant="success">{status}</Badge>
  if (status === "Additional Evidence Required")
    return <Badge variant="warning">{status}</Badge>
  if (status === "Not Ready") return <Badge variant="outline">{status}</Badge>
  return <Badge variant="info">{status}</Badge>
}

export function CertificateBadge({ status }: { status: CertificateStatus }) {
  if (status === "Delivered to Client" || status === "Certificate File Received")
    return <Badge variant="success">{status}</Badge>
  if (status === "Issued") return <Badge variant="success">{status}</Badge>
  if (status === "Pending") return <Badge variant="warning">{status}</Badge>
  return <Badge variant="outline">{status}</Badge>
}
