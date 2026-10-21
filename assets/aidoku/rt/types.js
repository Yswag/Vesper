/**
 * @nemu.pm/aidoku-runtime types
 *
 * Types matching Aidoku's Swift/Rust structures for WASM source interop.
 */
// ============================================================================
// Filter Types
// ============================================================================
// NOTE: These are NOT the same as Swift's OLD ABI FilterType values!
// Swift OLD ABI uses: base=0, group=1, text=2, check=3, select=4, sort=5, sortSelection=6, title=7, author=8, genre=9
// The runtime converts these to the appropriate format for each ABI
export const FilterType = {
    Title: 0,
    Author: 1,
    Select: 2,
    Sort: 3,
    Check: 4,
    Group: 5,
    Genre: 6,
    Text: 7,
};
export const GenreState = {
    Excluded: -1,
    None: 0,
    Included: 1,
};
export const ListingKind = {
    Default: 0,
    List: 1,
};
// ============================================================================
// Enums
// ============================================================================
export const MangaStatus = {
    Unknown: 0,
    Ongoing: 1,
    Completed: 2,
    Cancelled: 3,
    Hiatus: 4,
};
export const ContentRating = {
    Safe: 0,
    Suggestive: 1,
    Nsfw: 2,
};
export const Viewer = {
    Default: 0,
    RightToLeft: 1,
    LeftToRight: 2,
    Vertical: 3,
    Webtoon: 4,
};
// Object type enum matching WasmStd
export const ObjectType = {
    Null: 0,
    Int: 1,
    Float: 2,
    String: 3,
    Bool: 4,
    Array: 5,
    Object: 6,
    Date: 7,
    Node: 8,
    Unknown: 9,
};
// ============================================================================
// Runtime Mode
// ============================================================================
/** Runtime mode detection for WASM sources */
export const RuntimeMode = {
    /** Legacy Swift-era ABI */
    Legacy: "legacy",
    /** Modern aidoku-rs ABI */
    AidokuRs: "aidoku-rs",
};
//# sourceMappingURL=types.js.map