import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorRole: { type: String, enum: ['patient', 'doctor', 'staff', 'admin', 'anonymous'], required: true },
  action: { type: String, required: true, trim: true, maxlength: 80 },
  entityType: { type: String, required: true, trim: true, maxlength: 80 },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  note: { type: String, default: '', trim: true, maxlength: 100 },
  ip: { type: String, default: '', maxlength: 100 },
}, { timestamps: { createdAt: 'at', updatedAt: false } });

auditLogSchema.index({ at: -1 });

export default mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
