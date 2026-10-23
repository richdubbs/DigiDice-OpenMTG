/** Capacity admission (design 4.6, D16; package M13-10): the FIFO capacity queue on `api.ts`'s contract and the runtime's signals. */
export * from './api';
export { CapacityAdmission, SOFT_SIGNALS, type AdmissionStats, type CapacityAdmissionOptions } from './queue';
export { FreedWindow } from './freed-window';
export { admissionLimitsOf, checkAdmissionLimits, checkAdmissionTiming, DEFAULT_ADMISSION_TIMING, startRequestFor, withDefaults, type AdmissionTiming } from './limits';
