/**
 * Utilities for parsing Move object type strings into structured type arguments.
 *
 * Sui object types carry generic parameters as part of their type string,
 * e.g. `{PKG}::swap::Swap<0x…::nft::MyNFT, 0x2::sui::SUI>`. These utilities
 * extract those parameters so the UI can display human-readable type names and
 * construct correct PTB type-argument arrays.
 */

// ── Result types ────────────────────────────────────────────────────

export interface SwapTypeArgs {
  kind: 'swap';
  /** Move type tag of T — the creator's deposited asset */
  itemType: string;
  /** Move type tag of CoinType — the payment coin (e.g. `0x2::sui::SUI`) */
  coinType: string;
}

export interface ObjectSwapTypeArgs {
  kind: 'object_swap';
  /** Move type tag of T — the creator's deposited asset */
  itemType: string;
  /** Move type tag of U — the expected counter-asset */
  counterItemType: string;
}

export type ParsedSwapTypeArgs = SwapTypeArgs | ObjectSwapTypeArgs;

// ── Core parser ─────────────────────────────────────────────────────

/**
 * Extract top-level generic type parameters from a Move type string.
 *
 * Handles nested generics correctly by tracking angle-bracket depth.
 *
 * @example
 * ```
 * extractTypeParams("0x…::swap::Swap<0x…::nft::NFT, 0x2::sui::SUI>")
 * // → ["0x…::nft::NFT", "0x2::sui::SUI"]
 *
 * extractTypeParams("0x…::coin::Coin<0x2::sui::SUI>")
 * // → ["0x2::sui::SUI"]
 * ```
 */
export function extractTypeParams(typeStr: string): string[] {
  const open = typeStr.indexOf('<');
  if (open === -1) return [];

  const inner = typeStr.slice(open + 1, typeStr.lastIndexOf('>'));
  const params: string[] = [];
  let depth = 0;
  let buf = '';

  for (const ch of inner) {
    if (ch === '<') {
      depth++;
      buf += ch;
    } else if (ch === '>') {
      depth--;
      buf += ch;
    } else if (ch === ',' && depth === 0) {
      params.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }

  if (buf.trim()) params.push(buf.trim());
  return params;
}

// ── High-level parser ───────────────────────────────────────────────

/**
 * Parse a Sui object type string for a Swap or ObjectSwap and extract
 * its generic type arguments as a discriminated union.
 *
 * Returns `null` if the type string doesn't match either pattern.
 *
 * @example
 * ```
 * parseSwapTypeArgs("0xabc::swap::Swap<0x…::nft::NFT, 0x2::sui::SUI>")
 * // → { kind: 'swap', itemType: '0x…::nft::NFT', coinType: '0x2::sui::SUI' }
 *
 * parseSwapTypeArgs("0xabc::object_swap::ObjectSwap<0x…::nft::A, 0x…::nft::B>")
 * // → { kind: 'object_swap', itemType: '0x…::nft::A', counterItemType: '0x…::nft::B' }
 * ```
 */
export function parseSwapTypeArgs(typeString: string): ParsedSwapTypeArgs | null {
  const params = extractTypeParams(typeString);
  if (params.length < 2) return null;

  // Determine module from the base type (everything before the first '<')
  const baseType = typeString.slice(0, typeString.indexOf('<'));

  if (baseType.endsWith('::swap::Swap')) {
    return {
      kind: 'swap',
      itemType: params[0],
      coinType: params[1],
    };
  }

  if (baseType.endsWith('::object_swap::ObjectSwap')) {
    return {
      kind: 'object_swap',
      itemType: params[0],
      counterItemType: params[1],
    };
  }

  return null;
}
