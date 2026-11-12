class DOMMatrixPolyfill {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  m11 = 1; m12 = 0; m13 = 0; m14 = 0;
  m21 = 0; m22 = 1; m23 = 0; m24 = 0;
  m31 = 0; m32 = 0; m33 = 1; m34 = 0;
  m41 = 0; m42 = 0; m43 = 0; m44 = 1;
  is2D = true;
  isIdentity = true;

  constructor(init?: any) {
    if (init === undefined) {
      return;
    }
    if (typeof init === 'string') {
      const match = init.match(/matrix\(([^)]+)\)/);
      if (match) {
        const parts = match[1].split(',').map(Number);
        this.set6(parts);
      }
    } else if (Array.isArray(init)) {
      if (init.length === 6) {
        this.set6(init);
      } else if (init.length === 16) {
        this.set16(init);
      }
    } else if (typeof init === 'object' && init !== null) {
      this.a = init.a !== undefined ? init.a : 1;
      this.b = init.b !== undefined ? init.b : 0;
      this.c = init.c !== undefined ? init.c : 0;
      this.d = init.d !== undefined ? init.d : 1;
      this.e = init.e !== undefined ? init.e : 0;
      this.f = init.f !== undefined ? init.f : 0;
      this.m11 = this.a; this.m12 = this.b; this.m21 = this.c; this.m22 = this.d;
      this.m41 = this.e; this.m42 = this.f;
    }
  }

  private set6(arr: number[]) {
    this.a = arr[0]; this.m11 = arr[0];
    this.b = arr[1]; this.m12 = arr[1];
    this.c = arr[2]; this.m21 = arr[2];
    this.d = arr[3]; this.m22 = arr[3];
    this.e = arr[4]; this.m41 = arr[4];
    this.f = arr[5]; this.m42 = arr[5];
  }

  private set16(arr: number[]) {
    this.m11 = arr[0]; this.m12 = arr[1]; this.m13 = arr[2]; this.m14 = arr[3];
    this.m21 = arr[4]; this.m22 = arr[5]; this.m23 = arr[6]; this.m24 = arr[7];
    this.m31 = arr[8]; this.m32 = arr[9]; this.m33 = arr[10]; this.m34 = arr[11];
    this.m41 = arr[12]; this.m42 = arr[13]; this.m43 = arr[14]; this.m44 = arr[15];
    this.a = this.m11; this.b = this.m12; this.c = this.m21; this.d = this.m22;
    this.e = this.m41; this.f = this.m42;
    this.is2D = false;
  }

  multiply(other: any) {
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const e = this.a * other.e + this.c * other.f + this.e;
    const f = this.b * other.e + this.d * other.f + this.f;
    return new DOMMatrixPolyfill([a, b, c, d, e, f]);
  }

  translate(x = 0, y = 0, z = 0) {
    return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e + x * this.a + y * this.c, this.f + x * this.b + y * this.d]);
  }

  scale(x = 1, y = x, z = 1) {
    return new DOMMatrixPolyfill([this.a * x, this.b * x, this.c * y, this.d * y, this.e, this.f]);
  }
}

class DOMPointPolyfill {
  x: number; y: number; z: number; w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }
}

if (typeof globalThis !== 'undefined') {
  if (!(globalThis as any).DOMMatrix) {
    (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
  }
  if (!(globalThis as any).DOMPoint) {
    (globalThis as any).DOMPoint = DOMPointPolyfill;
  }
}

// Polyfill Promise.try which is expected by modern packages in Node environment
if (typeof Promise !== 'undefined' && !(Promise as any).try) {
  (Promise as any).try = function<T>(callback: (...args: any[]) => T | PromiseLike<T>, ...args: any[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        resolve(callback(...args));
      } catch (error) {
        reject(error);
      }
    });
  };
}

// Polyfill Uint8Array.prototype.toHex (part of standard TC39 proposal) used by modern pdfjs-dist
if (typeof Uint8Array !== 'undefined' && !(Uint8Array.prototype as any).toHex) {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function(this: Uint8Array): string {
      return Array.from(this)
        .map(b => (b as number).toString(16).padStart(2, '0'))
        .join('');
    },
    writable: true,
    configurable: true,
    enumerable: false
  });
}

// Global fetch safety layer to handle HTML responses instead of throwing "Unexpected token '<'"
if (typeof window !== 'undefined') {
  try {
    const originalFetch = window.fetch;
    const safeFetch = async function(input: RequestInfo | URL, init?: RequestInit) {
      const response = await originalFetch(input, init);
      
      // Wrap the response.json method safely
      const originalJson = response.json;
      response.json = async function() {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          throw new Error('Sunucu hatası oluştu, lütfen tekrar deneyin.');
        }
        
        try {
          return await originalJson.call(response);
        } catch (err: any) {
          console.error('Fetch JSON safety layer caught parse error:', err);
          const errMsg = err?.message || '';
          if (errMsg.includes('Unexpected token') || errMsg.includes('is not valid JSON') || errMsg.includes('JSON.parse') || errMsg.includes('Unexpected character')) {
            throw new Error('Sunucu hatası oluştu, lütfen tekrar deneyin.');
          }
          throw err;
        }
      };
      
      return response;
    };

    Object.defineProperty(window, 'fetch', {
      value: safeFetch,
      configurable: true,
      writable: true,
      enumerable: true
    });
  } catch (e) {
    console.error('Could not override window.fetch with Object.defineProperty:', e);
  }
}


