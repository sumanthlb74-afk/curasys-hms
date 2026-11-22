export const departments = Object.freeze([
  'Cardiology',
  'Neurology',
  'Orthopedics',
  'General Medicine',
  'Pediatrics',
  'Emergency',
]);

export const wards = Object.freeze(['ICU', 'Emergency', 'General Ward', 'Pediatrics']);
export const triageLevels = Object.freeze(['Urgent', 'OPD Routine', 'Follow-up']);
export const bloodGroups = Object.freeze(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
export const userRoles = Object.freeze(['patient', 'doctor', 'staff', 'receptionist', 'admin']);
export const prescriptionAdviceSuggestions = Object.freeze([
  'Exercise regularly',
  'Eat more green vegetables',
  'Drink more water',
  'Reduce salt and sugar',
  'Get enough sleep',
  'Avoid smoking and alcohol',
  'Follow-up visit in 1 week',
]);
export const preliminaryCheckSymptoms = Object.freeze([
  'Fever and cold',
  'Headache and body ache',
  'Stomach pain or nausea',
  'Other',
]);
export const paymentMethods = Object.freeze(['Cash', 'Card', 'UPI QR', 'Net Banking']);
export const defaultClinicStartHour = 8;
export const defaultClinicEndHour = 20;
