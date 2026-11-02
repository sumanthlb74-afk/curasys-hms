import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { bloodGroups } from '../../shared/constants.js';

const emergencyContactSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '', maxlength: 100 },
  relationship: { type: String, trim: true, default: '', maxlength: 50 },
  phone: { type: String, trim: true, default: '', maxlength: 30 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  password: { type: String, required: true, minlength: 8, select: false },
  role: { type: String, enum: ['patient', 'doctor', 'staff', 'admin'], required: true },
  uhid: { type: String, default: null, required() { return this.role === 'patient'; } },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isActive: { type: Boolean, default: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  mustChangePassword: { type: Boolean, default: false },
  passwordChangedAt: { type: Date, default: null },
  sessionVersion: { type: Number, default: 0, min: 0 },
  phone: { type: String, trim: true, default: '', maxlength: 30 },
  specialization: { type: String, trim: true, default: '', maxlength: 100 },
  dateOfBirth: { type: Date, default: null, validate: { validator: (value) => !value || value <= new Date(), message: 'Date of birth cannot be in the future.' } },
  sex: { type: String, enum: ['', 'Female', 'Male', 'Intersex', 'Prefer not to say'], default: '' },
  bloodGroup: { type: String, enum: ['', ...bloodGroups], default: '' },
  address: { type: String, trim: true, default: '', maxlength: 500 },
  emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
  allergies: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  chronicConditions: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  currentMedications: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  heightCm: { type: Number, min: 30, max: 250, default: null },
  weightKg: { type: Number, min: 1, max: 500, default: null },
}, { timestamps: true });

userSchema.index(
  { uhid: 1 },
  { unique: true, partialFilterExpression: { uhid: { $type: 'string' } } },
);

userSchema.pre('save', async function hashPassword() {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

userSchema.methods.verifyPassword = function verifyPassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.models.User || mongoose.model('User', userSchema);
