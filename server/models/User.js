import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

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
  uhid: { type: String, unique: true, required: true },
  phone: { type: String, trim: true, default: '', maxlength: 30 },
  specialization: { type: String, trim: true, default: '', maxlength: 100 },
  dateOfBirth: { type: Date, default: null, validate: { validator: (value) => !value || value <= new Date(), message: 'Date of birth cannot be in the future.' } },
  sex: { type: String, enum: ['', 'Female', 'Male', 'Intersex', 'Prefer not to say'], default: '' },
  bloodGroup: { type: String, enum: ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], default: '' },
  address: { type: String, trim: true, default: '', maxlength: 500 },
  emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
  allergies: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  chronicConditions: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  currentMedications: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  heightCm: { type: Number, min: 30, max: 250, default: null },
  weightKg: { type: Number, min: 1, max: 500, default: null },
}, { timestamps: true });

userSchema.pre('save', async function hashPassword() {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

userSchema.methods.verifyPassword = function verifyPassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: this.id,
    name: this.name,
    email: this.email,
    role: this.role,
    uhid: this.uhid,
    phone: this.phone,
    specialization: this.specialization,
    dateOfBirth: this.dateOfBirth,
    sex: this.sex,
    bloodGroup: this.bloodGroup,
    address: this.address,
    emergencyContact: this.emergencyContact,
    allergies: this.allergies,
    chronicConditions: this.chronicConditions,
    currentMedications: this.currentMedications,
    heightCm: this.heightCm,
    weightKg: this.weightKg,
  };
};

export default mongoose.models.User || mongoose.model('User', userSchema);
