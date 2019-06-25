"use strict";
let wasm_module = null;

function wasm_initialize() {
    if (wasm_module == null) {
        let wasm_bytes = wasm_fetch_module_bytes();
        wasm_module = new WebAssembly.Module(wasm_bytes);
    }
    let stdweb_vars = wasm_create_stdweb_vars();
    let wasm_instance = new WebAssembly.Instance(wasm_module, stdweb_vars.imports);
    stdweb_vars.initialize(wasm_instance);
    // assume the WASM main overrides this
    module.exports.loop();
}

module.exports.loop = wasm_initialize;


function wasm_fetch_module_bytes() {
    "use strict";
    return require('compiled');
}

function wasm_create_stdweb_vars() {
    "use strict";
    
    var Module = {};

    Module.STDWEB_PRIVATE = {};

// This is based on code from Emscripten's preamble.js.
Module.STDWEB_PRIVATE.to_utf8 = function to_utf8( str, addr ) {
    var HEAPU8 = Module.HEAPU8;
    for( var i = 0; i < str.length; ++i ) {
        // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
        var u = str.charCodeAt( i ); // possibly a lead surrogate
        if( u >= 0xD800 && u <= 0xDFFF ) {
            u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt( ++i ) & 0x3FF);
        }

        if( u <= 0x7F ) {
            HEAPU8[ addr++ ] = u;
        } else if( u <= 0x7FF ) {
            HEAPU8[ addr++ ] = 0xC0 | (u >> 6);
            HEAPU8[ addr++ ] = 0x80 | (u & 63);
        } else if( u <= 0xFFFF ) {
            HEAPU8[ addr++ ] = 0xE0 | (u >> 12);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 6) & 63);
            HEAPU8[ addr++ ] = 0x80 | (u & 63);
        } else if( u <= 0x1FFFFF ) {
            HEAPU8[ addr++ ] = 0xF0 | (u >> 18);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 12) & 63);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 6) & 63);
            HEAPU8[ addr++ ] = 0x80 | (u & 63);
        } else if( u <= 0x3FFFFFF ) {
            HEAPU8[ addr++ ] = 0xF8 | (u >> 24);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 18) & 63);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 12) & 63);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 6) & 63);
            HEAPU8[ addr++ ] = 0x80 | (u & 63);
        } else {
            HEAPU8[ addr++ ] = 0xFC | (u >> 30);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 24) & 63);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 18) & 63);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 12) & 63);
            HEAPU8[ addr++ ] = 0x80 | ((u >> 6) & 63);
            HEAPU8[ addr++ ] = 0x80 | (u & 63);
        }
    }
};

Module.STDWEB_PRIVATE.noop = function() {};
Module.STDWEB_PRIVATE.to_js = function to_js( address ) {
    var kind = Module.HEAPU8[ address + 12 ];
    if( kind === 0 ) {
        return undefined;
    } else if( kind === 1 ) {
        return null;
    } else if( kind === 2 ) {
        return Module.HEAP32[ address / 4 ];
    } else if( kind === 3 ) {
        return Module.HEAPF64[ address / 8 ];
    } else if( kind === 4 ) {
        var pointer = Module.HEAPU32[ address / 4 ];
        var length = Module.HEAPU32[ (address + 4) / 4 ];
        return Module.STDWEB_PRIVATE.to_js_string( pointer, length );
    } else if( kind === 5 ) {
        return false;
    } else if( kind === 6 ) {
        return true;
    } else if( kind === 7 ) {
        var pointer = Module.STDWEB_PRIVATE.arena + Module.HEAPU32[ address / 4 ];
        var length = Module.HEAPU32[ (address + 4) / 4 ];
        var output = [];
        for( var i = 0; i < length; ++i ) {
            output.push( Module.STDWEB_PRIVATE.to_js( pointer + i * 16 ) );
        }
        return output;
    } else if( kind === 8 ) {
        var arena = Module.STDWEB_PRIVATE.arena;
        var value_array_pointer = arena + Module.HEAPU32[ address / 4 ];
        var length = Module.HEAPU32[ (address + 4) / 4 ];
        var key_array_pointer = arena + Module.HEAPU32[ (address + 8) / 4 ];
        var output = {};
        for( var i = 0; i < length; ++i ) {
            var key_pointer = Module.HEAPU32[ (key_array_pointer + i * 8) / 4 ];
            var key_length = Module.HEAPU32[ (key_array_pointer + 4 + i * 8) / 4 ];
            var key = Module.STDWEB_PRIVATE.to_js_string( key_pointer, key_length );
            var value = Module.STDWEB_PRIVATE.to_js( value_array_pointer + i * 16 );
            output[ key ] = value;
        }
        return output;
    } else if( kind === 9 ) {
        return Module.STDWEB_PRIVATE.acquire_js_reference( Module.HEAP32[ address / 4 ] );
    } else if( kind === 10 || kind === 12 || kind === 13 ) {
        var adapter_pointer = Module.HEAPU32[ address / 4 ];
        var pointer = Module.HEAPU32[ (address + 4) / 4 ];
        var deallocator_pointer = Module.HEAPU32[ (address + 8) / 4 ];
        var num_ongoing_calls = 0;
        var drop_queued = false;
        var output = function() {
            if( pointer === 0 || drop_queued === true ) {
                if (kind === 10) {
                    throw new ReferenceError( "Already dropped Rust function called!" );
                } else if (kind === 12) {
                    throw new ReferenceError( "Already dropped FnMut function called!" );
                } else {
                    throw new ReferenceError( "Already called or dropped FnOnce function called!" );
                }
            }

            var function_pointer = pointer;
            if (kind === 13) {
                output.drop = Module.STDWEB_PRIVATE.noop;
                pointer = 0;
            }

            if (num_ongoing_calls !== 0) {
                if (kind === 12 || kind === 13) {
                    throw new ReferenceError( "FnMut function called multiple times concurrently!" );
                }
            }

            var args = Module.STDWEB_PRIVATE.alloc( 16 );
            Module.STDWEB_PRIVATE.serialize_array( args, arguments );

            try {
                num_ongoing_calls += 1;
                Module.STDWEB_PRIVATE.dyncall( "vii", adapter_pointer, [function_pointer, args] );
                var result = Module.STDWEB_PRIVATE.tmp;
                Module.STDWEB_PRIVATE.tmp = null;
            } finally {
                num_ongoing_calls -= 1;
            }

            if( drop_queued === true && num_ongoing_calls === 0 ) {
                output.drop();
            }

            return result;
        };

        output.drop = function() {
            if (num_ongoing_calls !== 0) {
                drop_queued = true;
                return;
            }

            output.drop = Module.STDWEB_PRIVATE.noop;
            var function_pointer = pointer;
            pointer = 0;

            if (function_pointer != 0) {
                Module.STDWEB_PRIVATE.dyncall( "vi", deallocator_pointer, [function_pointer] );
            }
        };

        return output;
    } else if( kind === 14 ) {
        var pointer = Module.HEAPU32[ address / 4 ];
        var length = Module.HEAPU32[ (address + 4) / 4 ];
        var array_kind = Module.HEAPU32[ (address + 8) / 4 ];
        var pointer_end = pointer + length;

        switch( array_kind ) {
            case 0:
                return Module.HEAPU8.subarray( pointer, pointer_end );
            case 1:
                return Module.HEAP8.subarray( pointer, pointer_end );
            case 2:
                return Module.HEAPU16.subarray( pointer, pointer_end );
            case 3:
                return Module.HEAP16.subarray( pointer, pointer_end );
            case 4:
                return Module.HEAPU32.subarray( pointer, pointer_end );
            case 5:
                return Module.HEAP32.subarray( pointer, pointer_end );
            case 6:
                return Module.HEAPF32.subarray( pointer, pointer_end );
            case 7:
                return Module.HEAPF64.subarray( pointer, pointer_end );
        }
    } else if( kind === 15 ) {
        return Module.STDWEB_PRIVATE.get_raw_value( Module.HEAPU32[ address / 4 ] );
    }
};

Module.STDWEB_PRIVATE.serialize_object = function serialize_object( address, value ) {
    var keys = Object.keys( value );
    var length = keys.length;
    var key_array_pointer = Module.STDWEB_PRIVATE.alloc( length * 8 );
    var value_array_pointer = Module.STDWEB_PRIVATE.alloc( length * 16 );
    Module.HEAPU8[ address + 12 ] = 8;
    Module.HEAPU32[ address / 4 ] = value_array_pointer;
    Module.HEAPU32[ (address + 4) / 4 ] = length;
    Module.HEAPU32[ (address + 8) / 4 ] = key_array_pointer;
    for( var i = 0; i < length; ++i ) {
        var key = keys[ i ];
        var key_address = key_array_pointer + i * 8;
        Module.STDWEB_PRIVATE.to_utf8_string( key_address, key );

        Module.STDWEB_PRIVATE.from_js( value_array_pointer + i * 16, value[ key ] );
    }
};

Module.STDWEB_PRIVATE.serialize_array = function serialize_array( address, value ) {
    var length = value.length;
    var pointer = Module.STDWEB_PRIVATE.alloc( length * 16 );
    Module.HEAPU8[ address + 12 ] = 7;
    Module.HEAPU32[ address / 4 ] = pointer;
    Module.HEAPU32[ (address + 4) / 4 ] = length;
    for( var i = 0; i < length; ++i ) {
        Module.STDWEB_PRIVATE.from_js( pointer + i * 16, value[ i ] );
    }
};

// New browsers and recent Node
var cachedEncoder = ( typeof TextEncoder === "function"
    ? new TextEncoder( "utf-8" )
    // Old Node (before v11)
    : ( typeof util === "object" && util && typeof util.TextEncoder === "function"
        ? new util.TextEncoder( "utf-8" )
        // Old browsers
        : null ) );

if ( cachedEncoder != null ) {
    Module.STDWEB_PRIVATE.to_utf8_string = function to_utf8_string( address, value ) {
        var buffer = cachedEncoder.encode( value );
        var length = buffer.length;
        var pointer = 0;

        if ( length > 0 ) {
            pointer = Module.STDWEB_PRIVATE.alloc( length );
            Module.HEAPU8.set( buffer, pointer );
        }

        Module.HEAPU32[ address / 4 ] = pointer;
        Module.HEAPU32[ (address + 4) / 4 ] = length;
    };

} else {
    Module.STDWEB_PRIVATE.to_utf8_string = function to_utf8_string( address, value ) {
        var length = Module.STDWEB_PRIVATE.utf8_len( value );
        var pointer = 0;

        if ( length > 0 ) {
            pointer = Module.STDWEB_PRIVATE.alloc( length );
            Module.STDWEB_PRIVATE.to_utf8( value, pointer );
        }

        Module.HEAPU32[ address / 4 ] = pointer;
        Module.HEAPU32[ (address + 4) / 4 ] = length;
    };
}

Module.STDWEB_PRIVATE.from_js = function from_js( address, value ) {
    var kind = Object.prototype.toString.call( value );
    if( kind === "[object String]" ) {
        Module.HEAPU8[ address + 12 ] = 4;
        Module.STDWEB_PRIVATE.to_utf8_string( address, value );
    } else if( kind === "[object Number]" ) {
        if( value === (value|0) ) {
            Module.HEAPU8[ address + 12 ] = 2;
            Module.HEAP32[ address / 4 ] = value;
        } else {
            Module.HEAPU8[ address + 12 ] = 3;
            Module.HEAPF64[ address / 8 ] = value;
        }
    } else if( value === null ) {
        Module.HEAPU8[ address + 12 ] = 1;
    } else if( value === undefined ) {
        Module.HEAPU8[ address + 12 ] = 0;
    } else if( value === false ) {
        Module.HEAPU8[ address + 12 ] = 5;
    } else if( value === true ) {
        Module.HEAPU8[ address + 12 ] = 6;
    } else if( kind === "[object Symbol]" ) {
        var id = Module.STDWEB_PRIVATE.register_raw_value( value );
        Module.HEAPU8[ address + 12 ] = 15;
        Module.HEAP32[ address / 4 ] = id;
    } else {
        var refid = Module.STDWEB_PRIVATE.acquire_rust_reference( value );
        Module.HEAPU8[ address + 12 ] = 9;
        Module.HEAP32[ address / 4 ] = refid;
    }
};

// New browsers and recent Node
var cachedDecoder = ( typeof TextDecoder === "function"
    ? new TextDecoder( "utf-8" )
    // Old Node (before v11)
    : ( typeof util === "object" && util && typeof util.TextDecoder === "function"
        ? new util.TextDecoder( "utf-8" )
        // Old browsers
        : null ) );

if ( cachedDecoder != null ) {
    Module.STDWEB_PRIVATE.to_js_string = function to_js_string( index, length ) {
        return cachedDecoder.decode( Module.HEAPU8.subarray( index, index + length ) );
    };

} else {
    // This is ported from Rust's stdlib; it's faster than
    // the string conversion from Emscripten.
    Module.STDWEB_PRIVATE.to_js_string = function to_js_string( index, length ) {
        var HEAPU8 = Module.HEAPU8;
        index = index|0;
        length = length|0;
        var end = (index|0) + (length|0);
        var output = "";
        while( index < end ) {
            var x = HEAPU8[ index++ ];
            if( x < 128 ) {
                output += String.fromCharCode( x );
                continue;
            }
            var init = (x & (0x7F >> 2));
            var y = 0;
            if( index < end ) {
                y = HEAPU8[ index++ ];
            }
            var ch = (init << 6) | (y & 63);
            if( x >= 0xE0 ) {
                var z = 0;
                if( index < end ) {
                    z = HEAPU8[ index++ ];
                }
                var y_z = ((y & 63) << 6) | (z & 63);
                ch = init << 12 | y_z;
                if( x >= 0xF0 ) {
                    var w = 0;
                    if( index < end ) {
                        w = HEAPU8[ index++ ];
                    }
                    ch = (init & 7) << 18 | ((y_z << 6) | (w & 63));

                    output += String.fromCharCode( 0xD7C0 + (ch >> 10) );
                    ch = 0xDC00 + (ch & 0x3FF);
                }
            }
            output += String.fromCharCode( ch );
            continue;
        }
        return output;
    };
}

Module.STDWEB_PRIVATE.id_to_ref_map = {};
Module.STDWEB_PRIVATE.id_to_refcount_map = {};
Module.STDWEB_PRIVATE.ref_to_id_map = new WeakMap();
// Not all types can be stored in a WeakMap
Module.STDWEB_PRIVATE.ref_to_id_map_fallback = new Map();
Module.STDWEB_PRIVATE.last_refid = 1;

Module.STDWEB_PRIVATE.id_to_raw_value_map = {};
Module.STDWEB_PRIVATE.last_raw_value_id = 1;

Module.STDWEB_PRIVATE.acquire_rust_reference = function( reference ) {
    if( reference === undefined || reference === null ) {
        return 0;
    }

    var id_to_refcount_map = Module.STDWEB_PRIVATE.id_to_refcount_map;
    var id_to_ref_map = Module.STDWEB_PRIVATE.id_to_ref_map;
    var ref_to_id_map = Module.STDWEB_PRIVATE.ref_to_id_map;
    var ref_to_id_map_fallback = Module.STDWEB_PRIVATE.ref_to_id_map_fallback;

    var refid = ref_to_id_map.get( reference );
    if( refid === undefined ) {
        refid = ref_to_id_map_fallback.get( reference );
    }
    if( refid === undefined ) {
        refid = Module.STDWEB_PRIVATE.last_refid++;
        try {
            ref_to_id_map.set( reference, refid );
        } catch (e) {
            ref_to_id_map_fallback.set( reference, refid );
        }
    }

    if( refid in id_to_ref_map ) {
        id_to_refcount_map[ refid ]++;
    } else {
        id_to_ref_map[ refid ] = reference;
        id_to_refcount_map[ refid ] = 1;
    }

    return refid;
};

Module.STDWEB_PRIVATE.acquire_js_reference = function( refid ) {
    return Module.STDWEB_PRIVATE.id_to_ref_map[ refid ];
};

Module.STDWEB_PRIVATE.increment_refcount = function( refid ) {
    Module.STDWEB_PRIVATE.id_to_refcount_map[ refid ]++;
};

Module.STDWEB_PRIVATE.decrement_refcount = function( refid ) {
    var id_to_refcount_map = Module.STDWEB_PRIVATE.id_to_refcount_map;
    if( 0 == --id_to_refcount_map[ refid ] ) {
        var id_to_ref_map = Module.STDWEB_PRIVATE.id_to_ref_map;
        var ref_to_id_map_fallback = Module.STDWEB_PRIVATE.ref_to_id_map_fallback;
        var reference = id_to_ref_map[ refid ];
        delete id_to_ref_map[ refid ];
        delete id_to_refcount_map[ refid ];
        ref_to_id_map_fallback.delete(reference);
    }
};

Module.STDWEB_PRIVATE.register_raw_value = function( value ) {
    var id = Module.STDWEB_PRIVATE.last_raw_value_id++;
    Module.STDWEB_PRIVATE.id_to_raw_value_map[ id ] = value;
    return id;
};

Module.STDWEB_PRIVATE.unregister_raw_value = function( id ) {
    delete Module.STDWEB_PRIVATE.id_to_raw_value_map[ id ];
};

Module.STDWEB_PRIVATE.get_raw_value = function( id ) {
    return Module.STDWEB_PRIVATE.id_to_raw_value_map[ id ];
};

Module.STDWEB_PRIVATE.alloc = function alloc( size ) {
    return Module.web_malloc( size );
};

Module.STDWEB_PRIVATE.dyncall = function( signature, ptr, args ) {
    return Module.web_table.get( ptr ).apply( null, args );
};

// This is based on code from Emscripten's preamble.js.
Module.STDWEB_PRIVATE.utf8_len = function utf8_len( str ) {
    var len = 0;
    for( var i = 0; i < str.length; ++i ) {
        // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        var u = str.charCodeAt( i ); // possibly a lead surrogate
        if( u >= 0xD800 && u <= 0xDFFF ) {
            u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt( ++i ) & 0x3FF);
        }

        if( u <= 0x7F ) {
            ++len;
        } else if( u <= 0x7FF ) {
            len += 2;
        } else if( u <= 0xFFFF ) {
            len += 3;
        } else if( u <= 0x1FFFFF ) {
            len += 4;
        } else if( u <= 0x3FFFFFF ) {
            len += 5;
        } else {
            len += 6;
        }
    }
    return len;
};

Module.STDWEB_PRIVATE.prepare_any_arg = function( value ) {
    var arg = Module.STDWEB_PRIVATE.alloc( 16 );
    Module.STDWEB_PRIVATE.from_js( arg, value );
    return arg;
};

Module.STDWEB_PRIVATE.acquire_tmp = function( dummy ) {
    var value = Module.STDWEB_PRIVATE.tmp;
    Module.STDWEB_PRIVATE.tmp = null;
    return value;
};

function __part_num_to_str(num) {
    switch (num) {
        case 0: return MOVE;
        case 1: return WORK;
        case 2: return CARRY;
        case 3: return ATTACK;
        case 4: return RANGED_ATTACK;
        case 5: return HEAL;
        case 6: return TOUGH;
        case 7: return CLAIM;
        default: throw new Error("unknown part integer encoding " + num);
    }
}

function __part_str_to_num(str) {
    switch (str) {
        case MOVE: return 0;
        case WORK: return 1;
        case CARRY: return 2;
        case ATTACK: return 3;
        case RANGED_ATTACK: return 4;
        case HEAL: return 5;
        case TOUGH: return 6;
        case CLAIM: return 7;
        default: throw new Error("unknown part type " + str);
    }
}

function __look_num_to_str(num) {
    switch (num) {
        case 0: return LOOK_CREEPS;
        case 1: return LOOK_ENERGY;
        case 2: return LOOK_RESOURCES;
        case 3: return LOOK_SOURCES;
        case 4: return LOOK_MINERALS;
        case 5: return LOOK_STRUCTURES;
        case 6: return LOOK_FLAGS;
        case 7: return LOOK_CONSTRUCTION_SITES;
        case 8: return LOOK_NUKES;
        case 9: return LOOK_TERRAIN;
        case 10: return LOOK_TOMBSTONES;
        default: throw new Error("unknown look integer encoding " + num);
    }
}

function __structure_type_num_to_str(num) {
    switch (num) {
        case 0: return STRUCTURE_SPAWN;
        case 1: return STRUCTURE_EXTENSION;
        case 2: return STRUCTURE_ROAD;
        case 3: return STRUCTURE_WALL;
        case 4: return STRUCTURE_RAMPART;
        case 5: return STRUCTURE_KEEPER_LAIR;
        case 6: return STRUCTURE_PORTAL;
        case 7: return STRUCTURE_CONTROLLER;
        case 8: return STRUCTURE_LINK;
        case 9: return STRUCTURE_STORAGE;
        case 10: return STRUCTURE_TOWER;
        case 11: return STRUCTURE_OBSERVER;
        case 12: return STRUCTURE_POWER_BANK;
        case 13: return STRUCTURE_POWER_SPAWN;
        case 14: return STRUCTURE_EXTRACTOR;
        case 15: return STRUCTURE_LAB;
        case 16: return STRUCTURE_TERMINAL;
        case 17: return STRUCTURE_CONTAINER;
        case 18: return STRUCTURE_NUKER;
        default: throw new Error("unknown structure type integer encoding " + num);
    }
}

function __structure_type_str_to_num(str) {
    switch (str) {
        case STRUCTURE_SPAWN: return 0;
        case STRUCTURE_EXTENSION: return 1;
        case STRUCTURE_ROAD: return 2;
        case STRUCTURE_WALL: return 3;
        case STRUCTURE_RAMPART: return 4;
        case STRUCTURE_KEEPER_LAIR: return 5;
        case STRUCTURE_PORTAL: return 6;
        case STRUCTURE_CONTROLLER: return 7;
        case STRUCTURE_LINK: return 8;
        case STRUCTURE_STORAGE: return 9;
        case STRUCTURE_TOWER: return 10;
        case STRUCTURE_OBSERVER: return 11;
        case STRUCTURE_POWER_BANK: return 12;
        case STRUCTURE_POWER_SPAWN: return 13;
        case STRUCTURE_EXTRACTOR: return 14;
        case STRUCTURE_LAB: return 15;
        case STRUCTURE_TERMINAL: return 16;
        case STRUCTURE_CONTAINER: return 17;
        case STRUCTURE_NUKER: return 18;
        default: throw new Error("unknown resource type " + str);
    }
}


function __resource_type_num_to_str(num) {
    switch (num) {
        case 1: return RESOURCE_ENERGY;
        case 2: return RESOURCE_POWER;
        case 3: return RESOURCE_HYDROGEN;
        case 4: return RESOURCE_OXYGEN;
        case 5: return RESOURCE_UTRIUM;
        case 6: return RESOURCE_LEMERGIUM;
        case 7: return RESOURCE_KEANIUM;
        case 8: return RESOURCE_ZYNTHIUM;
        case 9: return RESOURCE_CATALYST;
        case 10: return RESOURCE_GHODIUM;
        case 11: return RESOURCE_HYDROXIDE;
        case 12: return RESOURCE_ZYNTHIUM_KEANITE;
        case 13: return RESOURCE_UTRIUM_LEMERGITE;
        case 14: return RESOURCE_UTRIUM_HYDRIDE;
        case 15: return RESOURCE_UTRIUM_OXIDE;
        case 16: return RESOURCE_KEANIUM_HYDRIDE;
        case 17: return RESOURCE_KEANIUM_OXIDE;
        case 18: return RESOURCE_LEMERGIUM_HYDRIDE;
        case 19: return RESOURCE_LEMERGIUM_OXIDE;
        case 20: return RESOURCE_ZYNTHIUM_HYDRIDE;
        case 21: return RESOURCE_ZYNTHIUM_OXIDE;
        case 22: return RESOURCE_GHODIUM_HYDRIDE;
        case 23: return RESOURCE_GHODIUM_OXIDE;
        case 24: return RESOURCE_UTRIUM_ACID;
        case 25: return RESOURCE_UTRIUM_ALKALIDE;
        case 26: return RESOURCE_KEANIUM_ACID;
        case 27: return RESOURCE_KEANIUM_ALKALIDE;
        case 28: return RESOURCE_LEMERGIUM_ACID;
        case 29: return RESOURCE_LEMERGIUM_ALKALIDE;
        case 30: return RESOURCE_ZYNTHIUM_ACID;
        case 31: return RESOURCE_ZYNTHIUM_ALKALIDE;
        case 32: return RESOURCE_GHODIUM_ACID;
        case 33: return RESOURCE_GHODIUM_ALKALIDE;
        case 34: return RESOURCE_CATALYZED_UTRIUM_ACID;
        case 35: return RESOURCE_CATALYZED_UTRIUM_ALKALIDE;
        case 36: return RESOURCE_CATALYZED_KEANIUM_ACID;
        case 37: return RESOURCE_CATALYZED_KEANIUM_ALKALIDE;
        case 38: return RESOURCE_CATALYZED_LEMERGIUM_ACID;
        case 39: return RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE;
        case 40: return RESOURCE_CATALYZED_ZYNTHIUM_ACID;
        case 41: return RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE;
        case 42: return RESOURCE_CATALYZED_GHODIUM_ACID;
        case 43: return RESOURCE_CATALYZED_GHODIUM_ALKALIDE;
        default: throw new Error("unknown resource type integer encoding " + num);
    }
}

function __resource_type_str_to_num(str) {
    switch (str) {
        case RESOURCE_ENERGY: return 1;
        case RESOURCE_POWER: return 2;
        case RESOURCE_HYDROGEN: return 3;
        case RESOURCE_OXYGEN: return 4;
        case RESOURCE_UTRIUM: return 5;
        case RESOURCE_LEMERGIUM: return 6;
        case RESOURCE_KEANIUM: return 7;
        case RESOURCE_ZYNTHIUM: return 8;
        case RESOURCE_CATALYST: return 9;
        case RESOURCE_GHODIUM: return 10;
        case RESOURCE_HYDROXIDE: return 11;
        case RESOURCE_ZYNTHIUM_KEANITE: return 12;
        case RESOURCE_UTRIUM_LEMERGITE: return 13;
        case RESOURCE_UTRIUM_HYDRIDE: return 14;
        case RESOURCE_UTRIUM_OXIDE: return 15;
        case RESOURCE_KEANIUM_HYDRIDE: return 16;
        case RESOURCE_KEANIUM_OXIDE: return 17;
        case RESOURCE_LEMERGIUM_HYDRIDE: return 18;
        case RESOURCE_LEMERGIUM_OXIDE: return 19;
        case RESOURCE_ZYNTHIUM_HYDRIDE: return 20;
        case RESOURCE_ZYNTHIUM_OXIDE: return 21;
        case RESOURCE_GHODIUM_HYDRIDE: return 22;
        case RESOURCE_GHODIUM_OXIDE: return 23;
        case RESOURCE_UTRIUM_ACID: return 24;
        case RESOURCE_UTRIUM_ALKALIDE: return 25;
        case RESOURCE_KEANIUM_ACID: return 26;
        case RESOURCE_KEANIUM_ALKALIDE: return 27;
        case RESOURCE_LEMERGIUM_ACID: return 28;
        case RESOURCE_LEMERGIUM_ALKALIDE: return 29;
        case RESOURCE_ZYNTHIUM_ACID: return 30;
        case RESOURCE_ZYNTHIUM_ALKALIDE: return 31;
        case RESOURCE_GHODIUM_ACID: return 32;
        case RESOURCE_GHODIUM_ALKALIDE: return 33;
        case RESOURCE_CATALYZED_UTRIUM_ACID: return 34;
        case RESOURCE_CATALYZED_UTRIUM_ALKALIDE: return 35;
        case RESOURCE_CATALYZED_KEANIUM_ACID: return 36;
        case RESOURCE_CATALYZED_KEANIUM_ALKALIDE: return 37;
        case RESOURCE_CATALYZED_LEMERGIUM_ACID: return 38;
        case RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE: return 39;
        case RESOURCE_CATALYZED_ZYNTHIUM_ACID: return 40;
        case RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE: return 41;
        case RESOURCE_CATALYZED_GHODIUM_ACID: return 42;
        case RESOURCE_CATALYZED_GHODIUM_ALKALIDE: return 43;
        default: throw new Error("unknown resource type " + str);
    }
}

function __order_type_str_to_num(str) {
    switch (str) {
        case ORDER_SELL: return 0;
        case ORDER_BUY: return 1;
        default: throw new Error("unknown order type " + str);
    }
}

function __order_type_num_to_str(num) {
    switch (num) {
        case 0: return ORDER_SELL;
        case 1: return ORDER_BUY;
        default: throw new Error("unknown order type " + num);
    }
}

function console_error(...args) {
    console.log(...args);
    Game.notify(args.join(' '));
}



    var HEAP8 = null;
    var HEAP16 = null;
    var HEAP32 = null;
    var HEAPU8 = null;
    var HEAPU16 = null;
    var HEAPU32 = null;
    var HEAPF32 = null;
    var HEAPF64 = null;

    Object.defineProperty( Module, 'exports', { value: {} } );

    function __web_on_grow() {
        var buffer = Module.instance.exports.memory.buffer;
        HEAP8 = new Int8Array( buffer );
        HEAP16 = new Int16Array( buffer );
        HEAP32 = new Int32Array( buffer );
        HEAPU8 = new Uint8Array( buffer );
        HEAPU16 = new Uint16Array( buffer );
        HEAPU32 = new Uint32Array( buffer );
        HEAPF32 = new Float32Array( buffer );
        HEAPF64 = new Float64Array( buffer );
        Module.HEAP8 = HEAP8;
        Module.HEAP16 = HEAP16;
        Module.HEAP32 = HEAP32;
        Module.HEAPU8 = HEAPU8;
        Module.HEAPU16 = HEAPU16;
        Module.HEAPU32 = HEAPU32;
        Module.HEAPF32 = HEAPF32;
        Module.HEAPF64 = HEAPF64;
    }

    return {
        imports: {
            env: {
                "__cargo_web_snippet_06f2a873fc5ea5272c30121e9d33336c022234b5": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){var v=(($1));if(_.isArray(v)){return null;}else{return v;}})());
            },
            "__cargo_web_snippet_0ed7846d5ba5a92c562606660f0e86c42d2648e9": function($0, $1, $2) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).moveTo(($2));})());
            },
            "__cargo_web_snippet_10f5aa3985855124ab83b21d4e9f7297eb496508": function($0) {
                var o = Module.STDWEB_PRIVATE.acquire_js_reference( $0 );return (o instanceof Array) | 0;
            },
            "__cargo_web_snippet_15efe5dfddc469882135bfe2ab870a323cda8c66": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).name;})());
            },
            "__cargo_web_snippet_199d5eb25dfe761687bcd487578eb7e636bd9650": function($0) {
                $0 = Module.STDWEB_PRIVATE.to_js($0);console.log(($0));
            },
            "__cargo_web_snippet_1f4cfec94c8958211dad5d8bab4fc38464a58bb1": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).energy;})());
            },
            "__cargo_web_snippet_285aac3fba72d67cb459d37d4d21aa4fb62598ba": function($0) {
                Module.STDWEB_PRIVATE.arena = $0;
            },
            "__cargo_web_snippet_2e27ff96bd3a2017e0c1cc86c3709c9a78a0abf8": function($0) {
                Module.STDWEB_PRIVATE.from_js($0, (function(){return Object.keys(Game.creeps);})());
            },
            "__cargo_web_snippet_33307258eb68bacf04296ea3e0a511428cae9061": function($0, $1, $2) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);Module.STDWEB_PRIVATE.from_js($0, (function(){return Boolean(($1)[($2)]);})());
            },
            "__cargo_web_snippet_384ea725e8301c455e52a1e0b86b1e5535518fb3": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return _.sum(($1).carry);})());
            },
            "__cargo_web_snippet_3b7c7387d66489e5f65ef5c398f126590b9cb425": function($0, $1, $2) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).harvest(($2));})());
            },
            "__cargo_web_snippet_4ceaf469de28600d497adaa2b9aa6a18617db285": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).spawning;})());
            },
            "__cargo_web_snippet_53762cb6539c5965bbda8ef7acdd14b2a8858438": function($0, $1, $2) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).isNearTo(($2));})());
            },
            "__cargo_web_snippet_5430f76e684546fb403bea045db0b7eb95077c03": function($0) {
                Module.STDWEB_PRIVATE.from_js($0, (function(){return Game.cpu.getUsed();})());
            },
            "__cargo_web_snippet_5593c3821a538e639bbcc017606e17a01881d4c1": function($0, $1, $2) {
                $0 = Module.STDWEB_PRIVATE.to_js($0);$1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);(($0))[($1)]=($2);
            },
            "__cargo_web_snippet_5a116f3f2c15360e5d6e3aaa0f02f527197e23aa": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).pos;})());
            },
            "__cargo_web_snippet_60436ca69f7dc7c9342f95304873171ce977fde0": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).controller;})());
            },
            "__cargo_web_snippet_68abaca379ae7bcd742821109e1db18c3f58ea0c": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return Object.keys(($1));})());
            },
            "__cargo_web_snippet_6c2317ad659ee88341afa4853bf7eca22150cc52": function($0, $1, $2) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);Module.STDWEB_PRIVATE.from_js($0, (function(){return(($1))[($2)];})());
            },
            "__cargo_web_snippet_6fa935e68511d48cd55030b2ff471ea5b8b6fbbf": function($0) {
                Module.STDWEB_PRIVATE.from_js($0, (function(){return Memory;})());
            },
            "__cargo_web_snippet_72fc447820458c720c68d0d8e078ede631edd723": function($0, $1, $2) {
                console_error( 'Panic location:', Module.STDWEB_PRIVATE.to_js_string( $0, $1 ) + ':' + $2 );
            },
            "__cargo_web_snippet_777b239d8a1f73d6345ad6e506758a0d2bfa6e5c": function($0) {
                Module.STDWEB_PRIVATE.from_js($0, (function(){return Game.time;})());
            },
            "__cargo_web_snippet_7fb3858a72fd1ed4a1ec05fda1c86328341d2209": function($0) {
                $0 = Module.STDWEB_PRIVATE.to_js($0);var game_loop=($0);module.exports.loop=function(){try{game_loop();}catch(error){console_error("caught exception:",error);if(error.stack){console_error("stack trace:",error.stack);}console_error("resetting VM next tick.");module.exports.loop=wasm_initialize;}}
            },
            "__cargo_web_snippet_80d6d56760c65e49b7be8b6b01c1ea861b046bf0": function($0) {
                Module.STDWEB_PRIVATE.decrement_refcount( $0 );
            },
            "__cargo_web_snippet_8c32019649bb581b1b742eeedfc410e2bedd56a6": function($0, $1) {
                var array = Module.STDWEB_PRIVATE.acquire_js_reference( $0 );Module.STDWEB_PRIVATE.serialize_array( $1, array );
            },
            "__cargo_web_snippet_8fc86ff5a10838a7444dc482d88265abe81adb48": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).memory;})());
            },
            "__cargo_web_snippet_97495987af1720d8a9a923fa4683a7b683e3acd6": function($0, $1) {
                console_error( 'Panic error message:', Module.STDWEB_PRIVATE.to_js_string( $0, $1 ) );
            },
            "__cargo_web_snippet_b5d30913e2102c852c9baa76810c922f5af8637c": function($0, $1, $2) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).find(($2));})());
            },
            "__cargo_web_snippet_b9670d73c9a57cd663b56a8e90db987503fd9263": function($0, $1, $2, $3) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);$3 = Module.STDWEB_PRIVATE.to_js($3);Module.STDWEB_PRIVATE.from_js($0, (function(){var body=(($1)).map(__part_num_to_str);return($2).spawnCreep(body,($3));})());
            },
            "__cargo_web_snippet_c96836dbeaa3c5f8e6ac735f2bc778ef519a419f": function($0, $1, $2) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);$2 = Module.STDWEB_PRIVATE.to_js($2);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).upgradeController(($2));})());
            },
            "__cargo_web_snippet_cbb71603d41135125be2ba07c517bea433d6b1c6": function($0) {
                Module.STDWEB_PRIVATE.from_js($0, (function(){return Object.values(Game.spawns);})());
            },
            "__cargo_web_snippet_cc5efd526aa23414ce030500b7107f432da76448": function($0) {
                Module.STDWEB_PRIVATE.from_js($0, (function(){return Object.values(Game.creeps);})());
            },
            "__cargo_web_snippet_dc2fd915bd92f9e9c6a3bd15174f1414eee3dbaf": function() {
                console_error( 'Encountered a panic!' );
            },
            "__cargo_web_snippet_e9638d6405ab65f78daf4a5af9c9de14ecf1e2ec": function($0) {
                $0 = Module.STDWEB_PRIVATE.to_js($0);Module.STDWEB_PRIVATE.unregister_raw_value(($0));
            },
            "__cargo_web_snippet_e9c87ca536ef03f581b0f458357c95d2227ecede": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).carryCapacity;})());
            },
            "__cargo_web_snippet_eef29234147a0b83fd031e1d547c801ae14498fa": function($0) {
                var o = Module.STDWEB_PRIVATE.acquire_js_reference( $0 );return (o instanceof StructureController) | 0;
            },
            "__cargo_web_snippet_ef3b0175046828d2d6abfbaec3b4b9fd306a9832": function($0, $1) {
                $0 = Module.STDWEB_PRIVATE.to_js($0);$1 = Module.STDWEB_PRIVATE.to_js($1);(($0))[($1)]=undefined;
            },
            "__cargo_web_snippet_f7a1eb85cd15ff70d8f03eb12616f6f7f7a2c687": function($0, $1) {
                $1 = Module.STDWEB_PRIVATE.to_js($1);Module.STDWEB_PRIVATE.from_js($0, (function(){return($1).room;})());
            },
            "__cargo_web_snippet_f850f16221f3b798317e8eb101b7f82ca3948a08": function($0) {
                $0 = Module.STDWEB_PRIVATE.to_js($0);Game.notify(($0));
            },
            "__cargo_web_snippet_ff5103e6cc179d13b4c7a785bdce2708fd559fc0": function($0) {
                Module.STDWEB_PRIVATE.tmp = Module.STDWEB_PRIVATE.to_js( $0 );
            },
                "__web_on_grow": __web_on_grow
            }
        },
        initialize: function( instance ) {
            Object.defineProperty( Module, 'instance', { value: instance } );
            Object.defineProperty( Module, 'web_malloc', { value: Module.instance.exports.__web_malloc } );
            Object.defineProperty( Module, 'web_free', { value: Module.instance.exports.__web_free } );
            Object.defineProperty( Module, 'web_table', { value: Module.instance.exports.__indirect_function_table } );

            
            __web_on_grow();
            Module.instance.exports.main();

            return Module.exports;
        }
    };
}
