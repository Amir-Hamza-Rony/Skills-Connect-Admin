import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

export type CommChannel = "email" | "sms" | "whatsapp" | "phone" | "letter";
export type CommDirection = "inbound" | "outbound";
export type CommStatus = "sent" | "delivered" | "read" | "failed" | "bounced";

export interface CommunicationAttrs {
  clientId: Types.ObjectId;
  orderId: Types.ObjectId | null;
  channel: CommChannel;
  direction: CommDirection;
  message: string;
  status: CommStatus;
  sentAt: Date | null;
  externalReference: string | null; // e.g. WhatsApp message ID, SMS gateway ID
  createdAt: Date;
  updatedAt: Date;
}

const communicationSchema = new Schema<CommunicationAttrs>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    channel: {
      type: String,
      required: true,
      enum: ["email", "sms", "whatsapp", "phone", "letter"],
    },
    direction: {
      type: String,
      required: true,
      enum: ["inbound", "outbound"],
    },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: ["sent", "delivered", "read", "failed", "bounced"],
      default: "sent",
    },
    sentAt: { type: Date, default: null },
    externalReference: { type: String, default: null, trim: true },
  },
  { timestamps: true, versionKey: false },
);

communicationSchema.index({ clientId: 1, createdAt: -1 });
communicationSchema.index({ orderId: 1, createdAt: -1 });
communicationSchema.index({ channel: 1, direction: 1 });
communicationSchema.index({ status: 1 });

export type CommunicationDoc = HydratedDocument<CommunicationAttrs>;
export type CommunicationLean = CommunicationAttrs & { _id: Types.ObjectId };

export const Communication: Model<CommunicationAttrs> = model<CommunicationAttrs>(
  "Communication",
  communicationSchema,
);
