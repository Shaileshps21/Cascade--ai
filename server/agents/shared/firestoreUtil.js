/**
 * shared/firestoreUtil.js
 * Small helpers for working with Firestore data without requiring composite
 * indexes. Several agents used to combine `.where(field).orderBy(otherField)`
 * queries, which Firestore only allows when a matching composite index has
 * been deployed — something this environment can't guarantee. The fix is to
 * filter with `.where()` alone (always index-free) and sort the results in
 * memory instead, which is what `toMillis()` below supports.
 */

/**
 * Convert a Firestore field value to epoch milliseconds, regardless of
 * whether it was stored as a Firestore `Timestamp` (has `.toDate()`), an ISO
 * string, a `Date` instance, or a raw number. Returns 0 for anything else
 * (null/undefined/unparseable), so sorting never throws and unknown dates
 * sort oldest.
 * @param {*} value
 * @returns {number}
 */
export function toMillis(value) {
    if (value == null) return 0;
    if (typeof value?.toDate === 'function') {
        const d = value.toDate();
        return Number.isNaN(d?.getTime?.()) ? 0 : d.getTime();
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Strict counterpart to `toMillis()`: returns `null` instead of `0` when the
 * value is missing or unparseable.
 *
 * Use this whenever the result feeds arithmetic rather than a sort. `toMillis()`
 * deliberately collapses unknown dates to epoch 0 so they sort oldest, but in a
 * subtraction that sentinel silently reads as "1970", turning a missing
 * timestamp into a ~56-year duration instead of an absent one.
 * @param {*} value
 * @returns {number|null}
 */
export function toMillisOrNull(value) {
    if (value == null) return null;
    if (typeof value?.toDate === 'function') {
        const d = value.toDate();
        return Number.isNaN(d?.getTime?.()) ? null : d.getTime();
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
}
