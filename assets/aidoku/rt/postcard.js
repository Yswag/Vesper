/**
 * Postcard serialization/deserialization for Aidoku WASM communication.
 * Uses @variegated-coffee/serde-postcard-ts for core primitives.
 */
import { tryEncodeString, tryEncodeVarintI64, tryDecodeString, tryDecodeVarintU32, tryDecodeVarintI64, tryDecodeF32, tryDecodeU8, } from "./serde.js";
import { FilterType, } from "./types.js";
export { tryEncodeString, tryDecodeString };
// ============================================================================
// Primitive Decoders
// ============================================================================
/** Encode a string for postcard format */
export function encodeString(str) {
    const result = tryEncodeString(str);
    if (!result.ok) {
        throw new Error(`Failed to encode string: ${result.error}`);
    }
    return result.value.bytes;
}
/** Decode a string from postcard format */
export function decodeString(bytes, offset = 0) {
    const result = tryDecodeString(bytes, offset);
    if (!result.ok) {
        throw new Error(`Failed to decode string at offset ${offset}: ${result.error}`);
    }
    return [result.value.value, result.value.bytesRead + offset];
}
/** Encode empty Vec (just length 0) */
export function encodeEmptyVec() {
    return new Uint8Array([0]);
}
/** Encode Option<String> - None = 0, Some = 1 + string */
export function encodeOptionString(str) {
    if (str === null) {
        return new Uint8Array([0]); // None
    }
    const strBytes = encodeString(str);
    const result = new Uint8Array(1 + strBytes.length);
    result[0] = 1; // Some
    result.set(strBytes, 1);
    return result;
}
/** Decode Option<String> */
export function decodeOptionString(bytes, offset = 0) {
    if (bytes[offset] === 0) {
        return [null, offset + 1];
    }
    return decodeString(bytes, offset + 1);
}
/** Decode varint u32 */
export function decodeVarint(bytes, offset = 0) {
    const result = tryDecodeVarintU32(bytes, offset);
    if (!result.ok) {
        throw new Error(`Failed to decode varint: ${result.error}`);
    }
    return [result.value.value, result.value.bytesRead + offset];
}
/** Decode i32 (little-endian fixed size) */
export function decodeI32(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    return [view.getInt32(0, true), offset + 4];
}
/** Decode i64 (zigzag varint, as number - may lose precision for very large values) */
export function decodeI64(bytes, offset) {
    const result = tryDecodeVarintI64(bytes, offset);
    if (!result.ok) {
        throw new Error(`Failed to decode i64: ${result.error}`);
    }
    return [Number(result.value.value), result.value.bytesRead + offset];
}
/** Decode f32 */
export function decodeF32(bytes, offset) {
    const result = tryDecodeF32(bytes, offset);
    if (!result.ok) {
        throw new Error(`Failed to decode f32: ${result.error}`);
    }
    return [result.value.value, result.value.bytesRead + offset];
}
/** Decode u8 */
export function decodeU8(bytes, offset) {
    const result = tryDecodeU8(bytes, offset);
    if (!result.ok) {
        throw new Error(`Failed to decode u8: ${result.error}`);
    }
    return [result.value.value, result.value.bytesRead + offset];
}
/** Decode bool */
export function decodeBool(bytes, offset) {
    return [bytes[offset] !== 0, offset + 1];
}
/** Decode Option<T> */
export function decodeOption(bytes, offset, decodeInner) {
    if (bytes[offset] === 0) {
        return [null, offset + 1];
    }
    return decodeInner(bytes, offset + 1);
}
/** Decode Vec<T> */
export function decodeVec(bytes, offset, decodeItem) {
    const [len, lenEnd] = decodeVarint(bytes, offset);
    const items = [];
    let pos = lenEnd;
    for (let i = 0; i < len; i++) {
        const [item, itemEnd] = decodeItem(bytes, pos);
        items.push(item);
        pos = itemEnd;
    }
    return [items, pos];
}
export function decodeChapter(bytes, offset) {
    let pos = offset;
    let key;
    let title;
    let chapterNumber;
    let volumeNumber;
    let dateUploaded;
    let scanlators;
    let url;
    let language;
    let thumbnail;
    let locked;
    [key, pos] = decodeString(bytes, pos);
    [title, pos] = decodeOption(bytes, pos, decodeString);
    [chapterNumber, pos] = decodeOption(bytes, pos, decodeF32);
    [volumeNumber, pos] = decodeOption(bytes, pos, decodeF32);
    [dateUploaded, pos] = decodeOption(bytes, pos, decodeI64);
    [scanlators, pos] = decodeOption(bytes, pos, (b, o) => decodeVec(b, o, decodeString));
    [url, pos] = decodeOption(bytes, pos, decodeString);
    [language, pos] = decodeOption(bytes, pos, decodeString);
    [thumbnail, pos] = decodeOption(bytes, pos, decodeString);
    [locked, pos] = decodeBool(bytes, pos);
    return [
        {
            key,
            title,
            chapterNumber,
            volumeNumber,
            dateUploaded,
            scanlators,
            url,
            language,
            thumbnail,
            locked,
        },
        pos,
    ];
}
export function decodeManga(bytes, offset) {
    let pos = offset;
    let key;
    let title;
    let cover;
    let artists;
    let authors;
    let description;
    let url;
    let tags;
    let status;
    let contentRating;
    let viewer;
    let updateStrategy;
    let nextUpdateTime;
    [key, pos] = decodeString(bytes, pos);
    [title, pos] = decodeString(bytes, pos);
    [cover, pos] = decodeOption(bytes, pos, decodeString);
    [artists, pos] = decodeOption(bytes, pos, (b, o) => decodeVec(b, o, decodeString));
    [authors, pos] = decodeOption(bytes, pos, (b, o) => decodeVec(b, o, decodeString));
    [description, pos] = decodeOption(bytes, pos, decodeString);
    [url, pos] = decodeOption(bytes, pos, decodeString);
    [tags, pos] = decodeOption(bytes, pos, (b, o) => decodeVec(b, o, decodeString));
    [status, pos] = decodeU8(bytes, pos);
    [contentRating, pos] = decodeU8(bytes, pos);
    [viewer, pos] = decodeU8(bytes, pos);
    [updateStrategy, pos] = decodeU8(bytes, pos);
    [nextUpdateTime, pos] = decodeOption(bytes, pos, decodeI64);
    let chapters;
    [chapters, pos] = decodeOption(bytes, pos, (b, o) => decodeVec(b, o, decodeChapter));
    return [
        {
            key,
            title,
            cover,
            artists,
            authors,
            description,
            url,
            tags,
            status,
            contentRating,
            viewer,
            updateStrategy,
            nextUpdateTime,
            chapters,
        },
        pos,
    ];
}
export function decodeMangaPageResult(bytes, offset = 0) {
    let pos = offset;
    const [entries, entriesEnd] = decodeVec(bytes, pos, decodeManga);
    pos = entriesEnd;
    const [hasNextPage] = decodeBool(bytes, pos);
    return { entries, hasNextPage };
}
export function decodePage(bytes, offset) {
    let pos = offset;
    let url = null;
    let text = null;
    let context = null;
    const [variant, variantEnd] = decodeVarint(bytes, pos);
    pos = variantEnd;
    if (variant === 0) {
        // Url(String, Option<PageContext>)
        [url, pos] = decodeString(bytes, pos);
        const hasContext = bytes[pos++];
        if (hasContext === 1) {
            context = {};
            const [mapLen, mapLenEnd] = decodeVarint(bytes, pos);
            pos = mapLenEnd;
            for (let i = 0; i < mapLen; i++) {
                let key, value;
                [key, pos] = decodeString(bytes, pos);
                [value, pos] = decodeString(bytes, pos);
                context[key] = value;
            }
        }
    }
    else if (variant === 1) {
        // Text(String)
        [text, pos] = decodeString(bytes, pos);
    }
    else if (variant === 2) {
        // Zip(String, String)
        let zipUrl, filePath;
        [zipUrl, pos] = decodeString(bytes, pos);
        [filePath, pos] = decodeString(bytes, pos);
        url = `${zipUrl}#${filePath}`;
    }
    let thumbnail;
    [thumbnail, pos] = decodeOption(bytes, pos, decodeString);
    let hasDescription;
    [hasDescription, pos] = decodeBool(bytes, pos);
    let description;
    [description, pos] = decodeOption(bytes, pos, decodeString);
    return [{ url, text, context, thumbnail, hasDescription, description }, pos];
}
export function decodePageList(bytes, offset = 0) {
    const [pages] = decodeVec(bytes, offset, decodePage);
    return pages;
}
function decodeSortSelection(bytes, offset) {
    let pos = offset;
    let index;
    let ascending;
    [index, pos] = decodeVarint(bytes, pos);
    [ascending, pos] = decodeBool(bytes, pos);
    return [{ index, ascending }, pos];
}
function decodeGenreSelection(bytes, offset) {
    let pos = offset;
    let index;
    let state;
    [index, pos] = decodeVarint(bytes, pos);
    const [stateRaw, stateEnd] = decodeVarint(bytes, pos);
    state = (stateRaw >>> 1) ^ -(stateRaw & 1);
    pos = stateEnd;
    return [{ index, state }, pos];
}
export function decodeFilter(bytes, offset) {
    let pos = offset;
    const [variant, variantEnd] = decodeVarint(bytes, pos);
    pos = variantEnd;
    let name;
    switch (variant) {
        case 0: // Title
            [name, pos] = decodeString(bytes, pos);
            return [{ type: 0, name }, pos];
        case 1: // Author
            [name, pos] = decodeString(bytes, pos);
            return [{ type: 1, name }, pos];
        case 2: {
            // Select
            [name, pos] = decodeString(bytes, pos);
            let options;
            [options, pos] = decodeVec(bytes, pos, decodeString);
            let defaultVal;
            [defaultVal, pos] = decodeVarint(bytes, pos);
            return [{ type: 2, name, options, default: defaultVal }, pos];
        }
        case 3: {
            // Sort
            [name, pos] = decodeString(bytes, pos);
            let options;
            [options, pos] = decodeVec(bytes, pos, decodeString);
            let defaultVal;
            [defaultVal, pos] = decodeSortSelection(bytes, pos);
            let canAscend;
            [canAscend, pos] = decodeBool(bytes, pos);
            return [{ type: 3, name, options, default: defaultVal, canAscend }, pos];
        }
        case 4: {
            // Check
            [name, pos] = decodeString(bytes, pos);
            let defaultVal;
            [defaultVal, pos] = decodeBool(bytes, pos);
            return [{ type: 4, name, default: defaultVal }, pos];
        }
        case 5: {
            // Group
            [name, pos] = decodeString(bytes, pos);
            let filters;
            [filters, pos] = decodeVec(bytes, pos, decodeFilter);
            return [{ type: 5, name, filters }, pos];
        }
        case 6: {
            // Genre
            [name, pos] = decodeString(bytes, pos);
            let options;
            [options, pos] = decodeVec(bytes, pos, decodeString);
            let canExclude;
            [canExclude, pos] = decodeBool(bytes, pos);
            let defaultVal;
            [defaultVal, pos] = decodeVec(bytes, pos, decodeGenreSelection);
            return [{ type: 6, name, options, canExclude, default: defaultVal }, pos];
        }
        default:
            throw new Error(`Unknown filter variant: ${variant}`);
    }
}
export function decodeFilterList(bytes, offset = 0) {
    const [filters] = decodeVec(bytes, offset, decodeFilter);
    return filters;
}
// ============================================================================
// Encoding Helpers
// ============================================================================
export function concatBytes(arrays) {
    const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
export function encodeVarint(val) {
    const bytes = [];
    while (val >= 0x80) {
        bytes.push((val & 0x7f) | 0x80);
        val >>>= 7;
    }
    bytes.push(val);
    return new Uint8Array(bytes);
}
export function encodeVecString(arr) {
    const parts = [];
    parts.push(encodeVarint(arr.length));
    for (const s of arr) {
        parts.push(encodeString(s));
    }
    return concatBytes(parts);
}
export function encodeBool(val) {
    return new Uint8Array([val ? 1 : 0]);
}
export function encodeI32(val) {
    const zigzag = (val << 1) ^ (val >> 31);
    return encodeVarint(zigzag >>> 0);
}
export function encodeF32(val) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, val, true);
    return new Uint8Array(buf);
}
export function encodeOptionBytes(str) {
    if (str === null)
        return new Uint8Array([0]);
    const strBytes = encodeString(str);
    const result = new Uint8Array(1 + strBytes.length);
    result[0] = 1;
    result.set(strBytes, 1);
    return result;
}
export function encodeOptionVecString(arr) {
    if (arr === null)
        return new Uint8Array([0]);
    const parts = [new Uint8Array([1])];
    parts.push(encodeVarint(arr.length));
    for (const s of arr) {
        parts.push(encodeString(s));
    }
    return concatBytes(parts);
}
export function encodeOptionF32(val) {
    if (val === null)
        return new Uint8Array([0]);
    const buf = new ArrayBuffer(5);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setFloat32(1, val, true);
    return new Uint8Array(buf);
}
export function encodeOptionI64(val) {
    if (val === null)
        return new Uint8Array([0]);
    const result = tryEncodeVarintI64(BigInt(val));
    if (!result.ok) {
        throw new Error(`Failed to encode i64: ${result.error}`);
    }
    const varintBytes = result.value.bytes;
    const combined = new Uint8Array(1 + varintBytes.length);
    combined[0] = 1;
    combined.set(varintBytes, 1);
    return combined;
}
// ============================================================================
// Manga/Chapter Encoders
// ============================================================================
export function encodeManga(manga) {
    const parts = [];
    parts.push(encodeString(manga.key || manga.id || ""));
    parts.push(encodeString(manga.title || ""));
    parts.push(encodeOptionBytes(manga.cover || null));
    parts.push(encodeOptionVecString(manga.artists || null));
    parts.push(encodeOptionVecString(manga.authors || null));
    parts.push(encodeOptionBytes(manga.description || null));
    parts.push(encodeOptionBytes(manga.url || null));
    parts.push(encodeOptionVecString(manga.tags || null));
    parts.push(new Uint8Array([manga.status || 0]));
    parts.push(new Uint8Array([manga.nsfw || 0]));
    parts.push(new Uint8Array([manga.viewer || 0]));
    parts.push(new Uint8Array([0])); // update_strategy
    parts.push(new Uint8Array([0])); // next_update_time (None)
    parts.push(new Uint8Array([0])); // chapters (None)
    return concatBytes(parts);
}
export function encodeHashMap(map) {
    const entries = Object.entries(map);
    const parts = [];
    parts.push(encodeVarint(entries.length));
    for (const [key, value] of entries) {
        parts.push(encodeString(key));
        parts.push(encodeString(value));
    }
    return concatBytes(parts);
}
// Encode PageContext (HashMap<String, String>)
export function encodePageContext(context) {
    if (context === null)
        return new Uint8Array([0]); // None
    const mapBytes = encodeHashMap(context);
    const result = new Uint8Array(1 + mapBytes.length);
    result[0] = 1; // Some
    result.set(mapBytes, 1);
    return result;
}
export function encodeU16(val) {
    const buf = new ArrayBuffer(2);
    const view = new DataView(buf);
    view.setUint16(0, val, true);
    return new Uint8Array(buf);
}
export function encodeImageResponse(code, headers, requestUrl, requestHeaders, imageRid) {
    const parts = [];
    parts.push(encodeU16(code));
    parts.push(encodeHashMap(headers));
    parts.push(encodeOptionBytes(requestUrl));
    parts.push(encodeHashMap(requestHeaders));
    parts.push(encodeI32(imageRid));
    return concatBytes(parts);
}
export function encodeChapter(chapter) {
    const parts = [];
    parts.push(encodeString(chapter.key || chapter.id || ""));
    parts.push(encodeOptionBytes(chapter.title || null));
    parts.push(encodeOptionF32(chapter.chapterNumber ?? null));
    parts.push(encodeOptionF32(chapter.volumeNumber ?? null));
    parts.push(encodeOptionI64(chapter.dateUploaded ? Math.floor(chapter.dateUploaded / 1000) : null));
    if (chapter.scanlator) {
        parts.push(new Uint8Array([1]));
        parts.push(encodeVarint(1));
        parts.push(encodeString(chapter.scanlator));
    }
    else {
        parts.push(new Uint8Array([0]));
    }
    parts.push(encodeOptionBytes(chapter.url || null));
    parts.push(encodeOptionBytes(chapter.lang || null));
    parts.push(new Uint8Array([0])); // thumbnail (None)
    parts.push(new Uint8Array([0])); // locked (false)
    return concatBytes(parts);
}
// ============================================================================
// FilterValue Encoders
// ============================================================================
export function encodeFilterValue(filter) {
    const parts = [];
    const id = filter.name || "";
    switch (filter.type) {
        case 0: // Title -> Text
        case 1: // Author -> Text
            parts.push(encodeVarint(0));
            parts.push(encodeString(id));
            parts.push(encodeString(String(filter.value || "")));
            break;
        case 3: {
            // Sort
            parts.push(encodeVarint(1));
            parts.push(encodeString(id));
            const sortVal = filter.value;
            parts.push(encodeI32(sortVal?.index ?? 0));
            parts.push(encodeBool(sortVal?.ascending ?? false));
            break;
        }
        case 4: // Check
            parts.push(encodeVarint(2));
            parts.push(encodeString(id));
            parts.push(encodeI32(filter.value ? 1 : 0));
            break;
        case 2: // Select
            parts.push(encodeVarint(3));
            parts.push(encodeString(id));
            parts.push(encodeString(String(filter.value ?? "")));
            break;
        case 6: {
            // Genre -> MultiSelect
            parts.push(encodeVarint(4));
            parts.push(encodeString(id));
            const multiVal = filter.value;
            parts.push(encodeVecString(multiVal?.included ?? []));
            parts.push(encodeVecString(multiVal?.excluded ?? []));
            break;
        }
        case 5: // Group
        default:
            parts.push(encodeVarint(0));
            parts.push(encodeString(id));
            parts.push(encodeString(""));
            break;
    }
    return concatBytes(parts);
}
export function encodeFilterValues(filters) {
    const parts = [];
    const validFilters = filters.filter((f) => f.type !== 5);
    parts.push(encodeVarint(validFilters.length));
    for (const filter of validFilters) {
        parts.push(encodeFilterValue(filter));
    }
    return concatBytes(parts);
}
/**
 * Decode a FilterValue from postcard format.
 * Returns [value, newOffset] or throws on error.
 */
export function decodeFilterValue(bytes, pos) {
    const [variant, variantEnd] = decodeVarint(bytes, pos);
    pos = variantEnd;
    let id;
    [id, pos] = decodeString(bytes, pos);
    switch (variant) {
        case 0: {
            // Text
            let value;
            [value, pos] = decodeString(bytes, pos);
            return [{ type: FilterType.Title, name: id, value }, pos];
        }
        case 1: {
            // Sort
            let index;
            let ascending;
            [index, pos] = decodeI32(bytes, pos);
            [ascending, pos] = decodeBool(bytes, pos);
            return [{ type: FilterType.Sort, name: id, value: { index, ascending } }, pos];
        }
        case 2: {
            // Check
            let value;
            [value, pos] = decodeI32(bytes, pos);
            return [{ type: FilterType.Check, name: id, value: value !== 0 }, pos];
        }
        case 3: {
            // Select
            let value;
            [value, pos] = decodeString(bytes, pos);
            return [{ type: FilterType.Select, name: id, value }, pos];
        }
        case 4: {
            // MultiSelect
            let included;
            let excluded;
            [included, pos] = decodeVec(bytes, pos, decodeString);
            [excluded, pos] = decodeVec(bytes, pos, decodeString);
            return [{ type: FilterType.Genre, name: id, value: { included, excluded } }, pos];
        }
        case 5: {
            // Range - skip Option<f32> from, Option<f32> to
            // We use Group type as a placeholder since Range isn't in FilterType
            const hasFrom = bytes[pos++];
            if (hasFrom === 1)
                pos += 4; // skip f32
            const hasTo = bytes[pos++];
            if (hasTo === 1)
                pos += 4; // skip f32
            return [{ type: FilterType.Group, name: id }, pos];
        }
        default:
            throw new Error(`Unknown FilterValue variant: ${variant}`);
    }
}
// ============================================================================
// Home Layout Decoders
// ============================================================================
function decodeOptionFloat(bytes, pos) {
    const tag = bytes[pos];
    if (tag === 0)
        return [undefined, pos + 1];
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos + 1, 4);
    return [view.getFloat32(0, true), pos + 5];
}
function decodeOptionInt(bytes, pos) {
    const tag = bytes[pos];
    if (tag === 0)
        return [undefined, pos + 1];
    const [val, newPos] = decodeVarint(bytes, pos + 1);
    return [val, newPos];
}
function decodeListing(bytes, pos) {
    let id, name;
    [id, pos] = decodeString(bytes, pos);
    [name, pos] = decodeString(bytes, pos);
    const kind = bytes[pos];
    pos += 1;
    return [{ id, name, kind }, pos];
}
function decodeOptionListing(bytes, pos) {
    const tag = bytes[pos];
    if (tag === 0)
        return [undefined, pos + 1];
    return decodeListing(bytes, pos + 1);
}
function decodeHomeLink(bytes, pos, sourceId) {
    let title;
    let subtitle;
    let imageUrl;
    let value;
    [title, pos] = decodeString(bytes, pos);
    [subtitle, pos] = decodeOptionString(bytes, pos);
    [imageUrl, pos] = decodeOptionString(bytes, pos);
    const hasValue = bytes[pos];
    pos += 1;
    if (hasValue === 1) {
        const valueType = bytes[pos];
        pos += 1;
        if (valueType === 0) {
            let url;
            [url, pos] = decodeString(bytes, pos);
            value = { type: "url", url };
        }
        else if (valueType === 1) {
            let listing;
            [listing, pos] = decodeListing(bytes, pos);
            value = { type: "listing", listing };
        }
        else if (valueType === 2) {
            const [decoded, newPos] = decodeManga(bytes, pos);
            pos = newPos;
            const manga = {
                sourceId,
                id: decoded.key,
                key: decoded.key,
                title: decoded.title || undefined,
                cover: decoded.cover || undefined,
                authors: decoded.authors || undefined,
                artists: decoded.artists || undefined,
                description: decoded.description || undefined,
                tags: decoded.tags || undefined,
                status: decoded.status,
                nsfw: decoded.contentRating,
            };
            value = { type: "manga", manga };
        }
    }
    return [{ title, subtitle: subtitle ?? undefined, imageUrl: imageUrl ?? undefined, value }, pos];
}
function decodeHomeFilterItem(bytes, pos) {
    let title;
    [title, pos] = decodeString(bytes, pos);
    const hasValues = bytes[pos];
    pos += 1;
    let values;
    if (hasValues === 1) {
        const [count, countEnd] = decodeVarint(bytes, pos);
        pos = countEnd;
        values = [];
        for (let i = 0; i < count; i++) {
            const [value, newPos] = decodeFilterValue(bytes, pos);
            values.push(value);
            pos = newPos;
        }
    }
    return [{ title, values }, pos];
}
function decodeMangaWithChapter(bytes, pos, sourceId) {
    const [decodedManga, mangaEnd] = decodeManga(bytes, pos);
    pos = mangaEnd;
    const manga = {
        sourceId,
        id: decodedManga.key,
        key: decodedManga.key,
        title: decodedManga.title || undefined,
        cover: decodedManga.cover || undefined,
        authors: decodedManga.authors || undefined,
        description: decodedManga.description || undefined,
        tags: decodedManga.tags || undefined,
        status: decodedManga.status,
    };
    // Chapter fields
    let chapterKey;
    let chapterTitle;
    let chapterNumber;
    let volumeNumber;
    let dateUploaded;
    let chapterScanlators;
    let chapterUrl;
    let chapterLang;
    [chapterKey, pos] = decodeString(bytes, pos);
    [chapterTitle, pos] = decodeOptionString(bytes, pos);
    // chapter_number: Option<f32>
    if (bytes[pos++] === 1) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + pos, 4);
        chapterNumber = view.getFloat32(0, true);
        pos += 4;
    }
    // volume_number: Option<f32>
    if (bytes[pos++] === 1) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + pos, 4);
        volumeNumber = view.getFloat32(0, true);
        pos += 4;
    }
    // date_uploaded: Option<i64>
    if (bytes[pos++] === 1) {
        const [date, dateEnd] = decodeVarint(bytes, pos);
        dateUploaded = date * 1000;
        pos = dateEnd;
    }
    // scanlators: Option<Vec<String>>
    if (bytes[pos++] === 1) {
        const [scanCount, scanEnd] = decodeVarint(bytes, pos);
        pos = scanEnd;
        chapterScanlators = [];
        for (let i = 0; i < scanCount; i++) {
            const [s, sEnd] = decodeString(bytes, pos);
            chapterScanlators.push(s);
            pos = sEnd;
        }
    }
    [chapterUrl, pos] = decodeOptionString(bytes, pos);
    [chapterLang, pos] = decodeOptionString(bytes, pos);
    // thumbnail: Option<String>
    const [, thumbnailEnd] = decodeOptionString(bytes, pos);
    pos = thumbnailEnd;
    // locked: bool
    pos += 1;
    const chapter = {
        key: chapterKey,
        title: chapterTitle ?? undefined,
        scanlator: chapterScanlators?.join(", "),
        url: chapterUrl ?? undefined,
        lang: chapterLang ?? undefined,
        chapterNumber,
        volumeNumber,
        dateUploaded,
    };
    return [{ manga, chapter }, pos];
}
function decodeHomeComponentValue(bytes, pos, sourceId) {
    const variant = bytes[pos];
    pos += 1;
    switch (variant) {
        case 0: { // ImageScroller
            const links = [];
            const [linkCount, linkEnd] = decodeVarint(bytes, pos);
            pos = linkEnd;
            for (let i = 0; i < linkCount; i++) {
                const [link, newPos] = decodeHomeLink(bytes, pos, sourceId);
                links.push(link);
                pos = newPos;
            }
            let autoScrollInterval;
            let width;
            let height;
            [autoScrollInterval, pos] = decodeOptionFloat(bytes, pos);
            [width, pos] = decodeOptionInt(bytes, pos);
            [height, pos] = decodeOptionInt(bytes, pos);
            return [{ type: "imageScroller", links, autoScrollInterval, width, height }, pos];
        }
        case 1: { // BigScroller
            const entries = [];
            const [entryCount, entryEnd] = decodeVarint(bytes, pos);
            pos = entryEnd;
            for (let i = 0; i < entryCount; i++) {
                const [decoded, newPos] = decodeManga(bytes, pos);
                pos = newPos;
                entries.push({
                    sourceId,
                    id: decoded.key,
                    key: decoded.key,
                    title: decoded.title || undefined,
                    cover: decoded.cover || undefined,
                    authors: decoded.authors || undefined,
                    artists: decoded.artists || undefined,
                    description: decoded.description || undefined,
                    tags: decoded.tags || undefined,
                    status: decoded.status,
                    nsfw: decoded.contentRating,
                });
            }
            let autoScrollInterval;
            [autoScrollInterval, pos] = decodeOptionFloat(bytes, pos);
            return [{ type: "bigScroller", entries, autoScrollInterval }, pos];
        }
        case 2: { // Scroller
            const entries = [];
            const [entryCount, entryEnd] = decodeVarint(bytes, pos);
            pos = entryEnd;
            for (let i = 0; i < entryCount; i++) {
                const [link, newPos] = decodeHomeLink(bytes, pos, sourceId);
                entries.push(link);
                pos = newPos;
            }
            let listing;
            [listing, pos] = decodeOptionListing(bytes, pos);
            return [{ type: "scroller", entries, listing }, pos];
        }
        case 3: { // MangaList
            const ranking = bytes[pos] === 1;
            pos += 1;
            let pageSize;
            [pageSize, pos] = decodeOptionInt(bytes, pos);
            const entries = [];
            const [entryCount, entryEnd] = decodeVarint(bytes, pos);
            pos = entryEnd;
            for (let i = 0; i < entryCount; i++) {
                const [link, newPos] = decodeHomeLink(bytes, pos, sourceId);
                entries.push(link);
                pos = newPos;
            }
            let listing;
            [listing, pos] = decodeOptionListing(bytes, pos);
            return [{ type: "mangaList", ranking, pageSize, entries, listing }, pos];
        }
        case 4: { // MangaChapterList
            let pageSize;
            [pageSize, pos] = decodeOptionInt(bytes, pos);
            const entries = [];
            const [entryCount, entryEnd] = decodeVarint(bytes, pos);
            pos = entryEnd;
            for (let i = 0; i < entryCount; i++) {
                const [entry, newPos] = decodeMangaWithChapter(bytes, pos, sourceId);
                entries.push(entry);
                pos = newPos;
            }
            let listing;
            [listing, pos] = decodeOptionListing(bytes, pos);
            return [{ type: "mangaChapterList", pageSize, entries, listing }, pos];
        }
        case 5: { // Filters
            const items = [];
            const [itemCount, itemEnd] = decodeVarint(bytes, pos);
            pos = itemEnd;
            for (let i = 0; i < itemCount; i++) {
                const [item, newPos] = decodeHomeFilterItem(bytes, pos);
                items.push(item);
                pos = newPos;
            }
            return [{ type: "filters", items }, pos];
        }
        case 6: { // Links
            const links = [];
            const [linkCount, linkEnd] = decodeVarint(bytes, pos);
            pos = linkEnd;
            for (let i = 0; i < linkCount; i++) {
                const [link, newPos] = decodeHomeLink(bytes, pos, sourceId);
                links.push(link);
                pos = newPos;
            }
            return [{ type: "links", links }, pos];
        }
        default:
            throw new Error(`Unknown HomeComponentValue variant: ${variant}`);
    }
}
export function decodeHomeComponent(bytes, pos, sourceId) {
    let title;
    let subtitle;
    let value;
    [title, pos] = decodeOptionString(bytes, pos);
    [subtitle, pos] = decodeOptionString(bytes, pos);
    [value, pos] = decodeHomeComponentValue(bytes, pos, sourceId);
    return [{ title: title ?? undefined, subtitle: subtitle ?? undefined, value }, pos];
}
export function decodeHomeLayout(bytes, sourceId) {
    let pos = 0;
    const [componentCount, countEnd] = decodeVarint(bytes, pos);
    pos = countEnd;
    const components = [];
    for (let i = 0; i < componentCount; i++) {
        const [component, newPos] = decodeHomeComponent(bytes, pos, sourceId);
        components.push(component);
        pos = newPos;
    }
    return { components };
}
//# sourceMappingURL=postcard.js.map