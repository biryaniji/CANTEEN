/**
 * RAZORPAY STANDARD CHECKOUT (SANDBOX TEST MODE)
 * Authentic Razorpay payment gateway simulation for Masters' Union Canteen
 */
(function(window) {
  'use strict';

  // Sound synthesis for Razorpay success chime (two-tone melodic sound)
  function playRazorpayChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Tone 1: High crisp bell
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.38);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.38);

      // Tone 2: Harmonious chime completion
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.14);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28); // D6
      gain2.gain.setValueAtTime(0.22, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.7);
    } catch (_) {}
  }

  // Generate realistic SVG QR Code for Razorpay UPI
  function generateRazorpayQRCodeSVG(vpa = 'mastersunion.canteen@razorpay') {
    // Generate pseudo-deterministic QR matrix pattern
    const size = 25;
    let rects = '';
    const hash = (x, y) => ((x * 17 + y * 23 + 47) % 7) > 2;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Finder patterns in 3 corners
        const isCorner1 = r < 7 && c < 7;
        const isCorner2 = r < 7 && c >= size - 7;
        const isCorner3 = r >= size - 7 && c < 7;
        const isCenterLogo = r >= 10 && r <= 14 && c >= 10 && c <= 14;

        if (isCenterLogo) continue; // reserve center for Razorpay emblem

        if (isCorner1 || isCorner2 || isCorner3) {
          const inR = (r < 7) ? r : (r - (size - 7));
          const inC = (c < 7) ? c : (c - (size - 7));
          const isBorder = inR === 0 || inR === 6 || inC === 0 || inC === 6;
          const isInner = inR >= 2 && inR <= 4 && inC >= 2 && inC <= 4;
          if (isBorder || isInner) {
            rects += `<rect x="${c * 6}" y="${r * 6}" width="6" height="6" fill="#0c2340"/>`;
          }
        } else if (hash(r, c)) {
          rects += `<rect x="${c * 6}" y="${r * 6}" width="6" height="6" fill="#0c2340"/>`;
        }
      }
    }

    return `
      <svg class="rzp-qr-svg" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg">
        <rect width="150" height="150" fill="#ffffff" rx="8"/>
        ${rects}
        <!-- Razorpay Blue Center Shield -->
        <rect x="58" y="58" width="34" height="34" rx="7" fill="#0c2340" stroke="#ffffff" stroke-width="2.5"/>
        <path d="M71 65 L79 65 L73 75 L80 75 L69 85 L72 77 L66 77 Z" fill="#2b83ea"/>
      </svg>
    `;
  }

  class RazorpaySandboxModal {
    constructor(options = {}) {
      this.options = Object.assign({
        key: 'rzp_test_MastersUnion2026',
        amount: 100, // INR
        currency: 'INR',
        name: "Masters' Union Canteen",
        description: 'Canteen Order Payment',
        image: '🍽️',
        order_id: null,
        prefill: {
          name: 'Kabir Ahuja',
          email: 'kabir.ahuja@mastersunion.org',
          contact: '+91 98765 43210'
        },
        theme: { color: '#0c2340' },
        items: [],
        slot: 'ASAP',
        handler: null,
        modal: { ondismiss: null }
      }, options);

      // Normalise amount (if in paise, convert to rupees for display)
      this.inrAmount = this.options.amount > 1000 && this.options.amount % 100 === 0
        ? this.options.amount / 100
        : Number(this.options.amount);

      this.orderId = this.options.order_id || ('order_sbx_' + Math.random().toString(36).substring(2, 12));
      this.activeTab = 'upi';
      this.selectedBank = 'HDFC';
      this.selectedWallet = 'paytm';
      this.selectedMethodName = 'UPI - Google Pay';
      this.forceFailure = false;
      this.qrTimerInterval = null;
      this.qrSecondsRemaining = 299; // 4m 59s
      this.isOpen = false;
    }

    async open() {
      // Proactively create order in backend if endpoint exists
      try {
        const resp = await fetch('/api/payment/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: this.inrAmount,
            currency: 'INR',
            receipt: 'rcpt_' + Date.now(),
            notes: { slot: this.options.slot, student: this.options.prefill.name }
          })
        });
        const data = await resp.json();
        if (data.success && data.order?.id) {
          this.orderId = data.order.id;
        }
      } catch (_) {}

      this.render();
      this.bindEvents();
      this.startQRTimer();
      this.isOpen = true;
    }

    render() {
      // Remove existing modal if any
      const existing = document.getElementById('rzp-sandbox-backdrop');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'rzp-sandbox-backdrop';
      backdrop.className = 'rzp-backdrop';

      backdrop.innerHTML = `
        <div class="rzp-modal" role="dialog" aria-modal="true" aria-label="Razorpay Checkout">
          <!-- Top Header -->
          <div class="rzp-header">
            <div class="rzp-merchant-info">
              <div class="rzp-merchant-avatar">
                <div class="rzp-avatar-placeholder">${this.options.image || 'MU'}</div>
              </div>
              <div class="rzp-merchant-meta">
                <h4>
                  ${this.options.name}
                  <span class="rzp-verified-badge" title="Razorpay Verified Business">✓</span>
                </h4>
                <div class="rzp-order-summary-link" id="rzp-view-breakdown-btn">
                  <span>${this.options.description || 'Order Summary'}</span>
                  <span style="font-size:9px">▼</span>
                </div>
              </div>
            </div>

            <div class="rzp-header-right">
              <div class="rzp-amount-badge">
                <div class="rzp-amount-label">Amount Payable</div>
                <div class="rzp-amount-val">₹${this.inrAmount.toFixed(2)}</div>
              </div>
              <button class="rzp-close-btn" id="rzp-btn-dismiss" title="Cancel Payment">✕</button>
            </div>

            <!-- Order Breakdown Dropdown Drawer -->
            <div class="rzp-order-drawer" id="rzp-order-drawer">
              <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:#0c2340;text-transform:uppercase;letter-spacing:.5px">
                Order Breakdown (${this.orderId})
              </div>
              ${(this.options.items && this.options.items.length) ? this.options.items.map(it => `
                <div class="rzp-drawer-item">
                  <span>${it.qty}x ${it.name}</span>
                  <b>₹${(it.price * it.qty).toFixed(2)}</b>
                </div>
              `).join('') : `
                <div class="rzp-drawer-item">
                  <span>Canteen Order Items</span>
                  <b>₹${this.inrAmount.toFixed(2)}</b>
                </div>
              `}
              <div class="rzp-drawer-item" style="color:#667085">
                <span>Pickup Slot</span>
                <span>${this.options.slot || 'ASAP'}</span>
              </div>
              <div class="rzp-drawer-item" style="color:#12b76a">
                <span>Campus Handling & Platform Fee</span>
                <b>FREE (₹0)</b>
              </div>
              <div class="rzp-drawer-total">
                <span>Total Amount</span>
                <span>₹${this.inrAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <!-- Sandbox Live Test Ribbon -->
          <div class="rzp-test-ribbon">
            <div class="rzp-test-status">
              <div class="rzp-pulse-beacon"></div>
              <span>⚡ RAZORPAY TEST MODE • Sandbox Active</span>
            </div>
            <div class="rzp-test-actions">
              <button class="rzp-test-btn" id="rzp-autofill-btn" title="Auto-fill verified test payment details">
                ⚡ Auto-Fill
              </button>
              <button class="rzp-test-btn" id="rzp-toggle-otp-btn" title="Test 3D Secure OTP verification screen">
                💬 Test OTP
              </button>
              <button class="rzp-test-btn danger" id="rzp-toggle-failure-btn" title="Toggle between success and failed payment simulation">
                ${this.forceFailure ? '🔴 Fail Mode (ON)' : '⚠️ Test Decline'}
              </button>
            </div>
          </div>

          <!-- Body with Sidebar Navigation & Payment Content -->
          <div class="rzp-body">
            <!-- Sidebar -->
            <div class="rzp-sidebar">
              <div class="rzp-nav-group-title">Payment Options</div>

              <button class="rzp-nav-item active" data-tab="upi">
                <div class="rzp-nav-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                    <line x1="12" y1="18" x2="12.01" y2="18"/>
                  </svg>
                </div>
                <div class="rzp-nav-text">
                  <div class="rzp-nav-title">UPI &amp; QR</div>
                  <div class="rzp-nav-subtitle"><span class="rzp-badge-mini">Fastest</span> GPay, PhonePe</div>
                </div>
              </button>

              <button class="rzp-nav-item" data-tab="card">
                <div class="rzp-nav-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                    <line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                </div>
                <div class="rzp-nav-text">
                  <div class="rzp-nav-title">Cards</div>
                  <div class="rzp-nav-subtitle">Visa, Mastercard, RuPay</div>
                </div>
              </button>

              <button class="rzp-nav-item" data-tab="netbanking">
                <div class="rzp-nav-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 21h18M3 10h18M5 10v11M19 10v11M9 10v11M15 10v11M12 2L2 7h20L12 2z"/>
                  </svg>
                </div>
                <div class="rzp-nav-text">
                  <div class="rzp-nav-title">Netbanking</div>
                  <div class="rzp-nav-subtitle">All Indian Banks</div>
                </div>
              </button>

              <button class="rzp-nav-item" data-tab="wallet">
                <div class="rzp-nav-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>
                  </svg>
                </div>
                <div class="rzp-nav-text">
                  <div class="rzp-nav-title">Wallets</div>
                  <div class="rzp-nav-subtitle">Paytm, PhonePe, Amazon</div>
                </div>
              </button>

              <button class="rzp-nav-item" data-tab="campus">
                <div class="rzp-nav-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                    <path d="M6 12v5c3 3 9 3 12 0v-5"/>
                  </svg>
                </div>
                <div class="rzp-nav-text">
                  <div class="rzp-nav-title">MU Campus Card</div>
                  <div class="rzp-nav-subtitle"><span class="rzp-badge-mini gold">Student ID</span> Bal: ₹1,500</div>
                </div>
              </button>

              <button class="rzp-nav-item" data-tab="counter">
                <div class="rzp-nav-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div class="rzp-nav-text">
                  <div class="rzp-nav-title">Pay on Counter</div>
                  <div class="rzp-nav-subtitle">Cash / Offline at Pickup</div>
                </div>
              </button>
            </div>

            <!-- Content Area -->
            <div class="rzp-content-container">
              <!-- PANEL 1: UPI -->
              <div class="rzp-tab-panel active" id="rzp-panel-upi">
                <div class="rzp-upi-header">
                  <div style="font-size:13.5px;font-weight:600;color:#1d2939">Scan QR or Pay with UPI</div>
                  <div class="rzp-upi-seg">
                    <button class="rzp-upi-seg-btn active" id="rzp-upi-sub-qr">Scan QR</button>
                    <button class="rzp-upi-seg-btn" id="rzp-upi-sub-id">UPI ID / Apps</button>
                  </div>
                </div>

                <!-- UPI Sub-view 1: QR Code -->
                <div id="rzp-upi-view-qr" class="rzp-qr-wrapper">
                  <div class="rzp-qr-card">
                    <div class="rzp-qr-laser"></div>
                    ${generateRazorpayQRCodeSVG()}
                  </div>
                  <div class="rzp-qr-timer">
                    <span>⚡ Code expires in</span>
                    <b id="rzp-qr-countdown">04:59</b>
                  </div>
                  <div style="font-size:12px;color:#475467;margin-top:6px">
                    Scan with any UPI App (Google Pay, PhonePe, Paytm, CRED)
                  </div>
                  <div class="rzp-upi-apps-row">
                    <span class="rzp-upi-app-chip">🟢 Google Pay</span>
                    <span class="rzp-upi-app-chip">🟣 PhonePe</span>
                    <span class="rzp-upi-app-chip">🔵 Paytm</span>
                    <span class="rzp-upi-app-chip">⚫ BHIM / CRED</span>
                  </div>

                  <button class="rzp-btn-pay success" id="rzp-btn-simulate-qr" style="margin-top:14px">
                    <span>📲 Simulate Phone Scan &amp; Pay (₹${this.inrAmount.toFixed(2)})</span>
                  </button>
                </div>

                <!-- UPI Sub-view 2: UPI ID & Fast Intent -->
                <div id="rzp-upi-view-id" style="display:none;padding-top:6px">
                  <div class="rzp-input-group">
                    <label class="rzp-label">Enter UPI ID / VPA</label>
                    <input type="text" class="rzp-input" id="rzp-vpa-input" value="kabir.ahuja@okhdfcbank" placeholder="username@okhdfcbank">
                  </div>
                  <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
                    <button class="rzp-test-btn" data-vpa-suffix="@okhdfcbank">@okhdfcbank</button>
                    <button class="rzp-test-btn" data-vpa-suffix="@okaxis">@okaxis</button>
                    <button class="rzp-test-btn" data-vpa-suffix="@paytm">@paytm</button>
                    <button class="rzp-test-btn" data-vpa-suffix="@ybl">@ybl</button>
                  </div>

                  <div style="font-size:12px;font-weight:600;color:#475467;margin-bottom:8px">Or select installed UPI App:</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
                    <button class="rzp-bank-card active rzp-app-pick" data-app="Google Pay">
                      <div style="font-size:16px;margin-bottom:2px">🟢</div>
                      <div class="rzp-bank-name">Google Pay</div>
                    </button>
                    <button class="rzp-bank-card rzp-app-pick" data-app="PhonePe">
                      <div style="font-size:16px;margin-bottom:2px">🟣</div>
                      <div class="rzp-bank-name">PhonePe</div>
                    </button>
                    <button class="rzp-bank-card rzp-app-pick" data-app="Paytm UPI">
                      <div style="font-size:16px;margin-bottom:2px">🔵</div>
                      <div class="rzp-bank-name">Paytm UPI</div>
                    </button>
                    <button class="rzp-bank-card rzp-app-pick" data-app="CRED UPI">
                      <div style="font-size:16px;margin-bottom:2px">⚫</div>
                      <div class="rzp-bank-name">CRED UPI</div>
                    </button>
                  </div>

                  <button class="rzp-btn-pay" id="rzp-btn-pay-vpa">
                    🔒 Pay ₹${this.inrAmount.toFixed(2)} via UPI
                  </button>
                </div>
              </div>

              <!-- PANEL 2: CARDS -->
              <div class="rzp-tab-panel" id="rzp-panel-card">
                <!-- Visual Card Preview -->
                <div class="rzp-card-preview" id="rzp-card-preview-box">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <div class="rzp-card-chip"></div>
                    <div id="rzp-card-brand-badge" style="font-size:12px;font-weight:800;letter-spacing:1px;color:#2b83ea">VISA</div>
                  </div>
                  <div class="rzp-card-num-display" id="rzp-card-num-text">4000 0012 3456 7890</div>
                  <div class="rzp-card-meta">
                    <div>
                      <div>CARDHOLDER</div>
                      <div class="rzp-card-holder-name" id="rzp-card-holder-text">${this.options.prefill.name.toUpperCase()}</div>
                    </div>
                    <div>
                      <div>EXPIRES</div>
                      <div id="rzp-card-exp-text" style="color:#fff;font-weight:600">12/28</div>
                    </div>
                  </div>
                </div>

                <!-- Preset Test Cards Picker -->
                <label class="rzp-label" style="display:flex;justify-content:space-between">
                  <span>Preset Sandbox Cards</span>
                  <span style="color:#2b83ea;font-size:11px">Auto-fill ready</span>
                </label>
                <select class="rzp-preset-select" id="rzp-card-preset-select">
                  <option value="visa_ok">⚡ Visa Test Card (Instant Approval) - 4000 0012 3456 7890</option>
                  <option value="mc_otp">⚡ Mastercard Test Card (With 3D OTP) - 5123 4567 8901 2345</option>
                  <option value="rupay_ok">⚡ RuPay Test Card (Instant Approval) - 6071 2345 6789 0123</option>
                  <option value="fail_funds">⚠️ Decline Test Card (Insufficient Funds) - 4000 0000 0000 0002</option>
                </select>

                <div class="rzp-input-group">
                  <label class="rzp-label">Card Number</label>
                  <input type="text" class="rzp-input" id="rzp-card-num-input" maxlength="19" value="4000 0012 3456 7890" placeholder="Card number">
                </div>

                <div class="rzp-row-2">
                  <div class="rzp-input-group">
                    <label class="rzp-label">Expiry (MM/YY)</label>
                    <input type="text" class="rzp-input" id="rzp-card-exp-input" maxlength="5" value="12/28" placeholder="MM/YY">
                  </div>
                  <div class="rzp-input-group">
                    <label class="rzp-label">CVV / CVC</label>
                    <input type="password" class="rzp-input" id="rzp-card-cvv-input" maxlength="4" value="123" placeholder="•••">
                  </div>
                </div>

                <div class="rzp-input-group">
                  <label class="rzp-label">Name on Card</label>
                  <input type="text" class="rzp-input" id="rzp-card-name-input" value="${this.options.prefill.name}" placeholder="Name as on card">
                </div>

                <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#475467;margin-top:4px;cursor:pointer">
                  <input type="checkbox" checked style="accent-color:#2b83ea">
                  <span>Save card securely as per RBI tokenization guidelines</span>
                </label>

                <button class="rzp-btn-pay" id="rzp-btn-pay-card">
                  🔒 Pay ₹${this.inrAmount.toFixed(2)}
                </button>
              </div>

              <!-- PANEL 3: NETBANKING -->
              <div class="rzp-tab-panel" id="rzp-panel-netbanking">
                <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#1d2939">Popular Indian Banks</div>
                <div class="rzp-banks-grid">
                  <div class="rzp-bank-card active" data-bank="HDFC">
                    <div class="rzp-bank-logo" style="background:#004c8f">HDFC</div>
                    <div class="rzp-bank-name">HDFC Bank</div>
                  </div>
                  <div class="rzp-bank-card" data-bank="SBI">
                    <div class="rzp-bank-logo" style="background:#0084c9">SBI</div>
                    <div class="rzp-bank-name">State Bank</div>
                  </div>
                  <div class="rzp-bank-card" data-bank="ICICI">
                    <div class="rzp-bank-logo" style="background:#b02a30">ICICI</div>
                    <div class="rzp-bank-name">ICICI Bank</div>
                  </div>
                  <div class="rzp-bank-card" data-bank="Axis">
                    <div class="rzp-bank-logo" style="background:#97144d">AXIS</div>
                    <div class="rzp-bank-name">Axis Bank</div>
                  </div>
                  <div class="rzp-bank-card" data-bank="Kotak">
                    <div class="rzp-bank-logo" style="background:#ed1c24">KM</div>
                    <div class="rzp-bank-name">Kotak Bank</div>
                  </div>
                  <div class="rzp-bank-card" data-bank="PNB">
                    <div class="rzp-bank-logo" style="background:#a20025">PNB</div>
                    <div class="rzp-bank-name">Punjab National</div>
                  </div>
                </div>

                <div class="rzp-input-group">
                  <label class="rzp-label">Or choose from 50+ other Indian banks</label>
                  <select class="rzp-input" id="rzp-netbanking-select">
                    <option value="HDFC">HDFC Bank</option>
                    <option value="SBI">State Bank of India</option>
                    <option value="ICICI">ICICI Bank</option>
                    <option value="Axis">Axis Bank</option>
                    <option value="Kotak">Kotak Mahindra Bank</option>
                    <option value="PNB">Punjab National Bank</option>
                    <option value="Bank of Baroda">Bank of Baroda</option>
                    <option value="Canara Bank">Canara Bank</option>
                    <option value="IDFC FIRST Bank">IDFC FIRST Bank</option>
                    <option value="IndusInd Bank">IndusInd Bank</option>
                    <option value="Yes Bank">Yes Bank</option>
                  </select>
                </div>

                <button class="rzp-btn-pay" id="rzp-btn-pay-nb">
                  🔒 Proceed via NetBanking (₹${this.inrAmount.toFixed(2)})
                </button>
              </div>

              <!-- PANEL 4: WALLETS -->
              <div class="rzp-tab-panel" id="rzp-panel-wallet">
                <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#1d2939">Available Digital Wallets</div>
                
                <div class="rzp-wallet-option active" data-wallet="paytm">
                  <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:32px;height:32px;border-radius:8px;background:#00b9f5;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:800">Paytm</div>
                    <div>
                      <div style="font-size:13px;font-weight:600">Paytm Wallet</div>
                      <div style="font-size:11px;color:#667085">Linked to +91 98*** **410 • Balance: ₹450.00</div>
                    </div>
                  </div>
                  <input type="radio" name="rzp-wallet-radio" checked style="accent-color:#2b83ea">
                </div>

                <div class="rzp-wallet-option" data-wallet="phonepe">
                  <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:32px;height:32px;border-radius:8px;background:#5f259f;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:800">PhPe</div>
                    <div>
                      <div style="font-size:13px;font-weight:600">PhonePe Wallet</div>
                      <div style="font-size:11px;color:#667085">1-click deduction</div>
                    </div>
                  </div>
                  <input type="radio" name="rzp-wallet-radio" style="accent-color:#2b83ea">
                </div>

                <div class="rzp-wallet-option" data-wallet="amazon">
                  <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:32px;height:32px;border-radius:8px;background:#ff9900;display:grid;place-items:center;color:#111;font-size:11px;font-weight:800">Amz</div>
                    <div>
                      <div style="font-size:13px;font-weight:600">Amazon Pay Balance</div>
                      <div style="font-size:11px;color:#667085">Quick Amazon Pay authorization</div>
                    </div>
                  </div>
                  <input type="radio" name="rzp-wallet-radio" style="accent-color:#2b83ea">
                </div>

                <button class="rzp-btn-pay" id="rzp-btn-pay-wallet">
                  🔒 Pay ₹${this.inrAmount.toFixed(2)} with Wallet
                </button>
              </div>

              <!-- PANEL 5: MU CAMPUS CARD -->
              <div class="rzp-tab-panel" id="rzp-panel-campus">
                <div class="rzp-student-pass-card">
                  <div class="rzp-student-card-header">
                    <div>
                      <div style="font-size:10.5px;color:#98a2b3;text-transform:uppercase;letter-spacing:.6px">Masters' Union Student Pass</div>
                      <div style="font-size:16px;font-weight:700;margin-top:2px">${this.options.prefill.name}</div>
                      <div style="font-size:11px;color:#d0d5dd;font-family:monospace;margin-top:2px">ID: MU-2026-ENG-410</div>
                    </div>
                    <div class="rzp-student-chip">Active Card</div>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px">
                    <div>
                      <div style="font-size:10px;color:#98a2b3">PREPAID CANTEEN BALANCE</div>
                      <div style="font-size:22px;font-weight:800;color:#12b76a">₹1,500.00</div>
                    </div>
                    <div style="font-size:11.5px;color:#d0d5dd">
                      After order: <b>₹${(1500 - this.inrAmount).toFixed(2)}</b>
                    </div>
                  </div>
                </div>

                <div style="font-size:12px;color:#475467;line-height:1.5;margin-bottom:12px">
                  Instant campus card debit. No OTP required. Automatically logs student transaction to campus food ledger.
                </div>

                <button class="rzp-btn-pay success" id="rzp-btn-pay-campus">
                  ⚡ Pay ₹${this.inrAmount.toFixed(2)} with Campus Pass
                </button>
              </div>

              <!-- PANEL 6: PAY ON COUNTER -->
              <div class="rzp-tab-panel" id="rzp-panel-counter">
                <div style="text-align:center;padding:24px 12px">
                  <div style="font-size:42px;margin-bottom:10px">💵</div>
                  <div style="font-size:16px;font-weight:700;color:#1d2939">Pay at Counter upon Pickup</div>
                  <div style="font-size:12.5px;color:#667085;max-width:320px;margin:8px auto 18px;line-height:1.5">
                    Your token will be issued immediately. You can pay cash or offline QR code directly at the food counter when collecting your meal.
                  </div>
                  <button class="rzp-btn-pay" id="rzp-btn-pay-counter" style="max-width:280px;margin:0 auto">
                    Confirm Order (Pay ₹${this.inrAmount.toFixed(2)} at Counter)
                  </button>
                </div>
              </div>

            </div>
          </div>

          <!-- Bottom Footer -->
          <div class="rzp-footer">
            <div class="rzp-footer-badge">
              <span>Secured by</span>
              <span class="rzp-brand-logo">Razor<span>pay</span></span>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <span>🔒 256-bit SSL</span>
              <span>•</span>
              <span>PCI-DSS Level 1</span>
              <span>•</span>
              <span>RBI Regulated</span>
            </div>
          </div>

          <!-- DYNAMIC OVERLAY CONTAINER (Processing, OTP, Success, Failure) -->
          <div id="rzp-modal-overlay-slot"></div>
        </div>
      </div>
      `;

      document.body.appendChild(backdrop);
      // Trigger CSS transition
      requestAnimationFrame(() => {
        backdrop.classList.add('rzp-open');
      });
    }

    bindEvents() {
      const backdrop = document.getElementById('rzp-sandbox-backdrop');
      if (!backdrop) return;

      // Close / Dismiss
      const closeBtn = document.getElementById('rzp-btn-dismiss');
      if (closeBtn) {
        closeBtn.onclick = () => this.handleDismiss();
      }

      // Order breakdown toggle
      const breakdownBtn = document.getElementById('rzp-view-breakdown-btn');
      const drawer = document.getElementById('rzp-order-drawer');
      if (breakdownBtn && drawer) {
        breakdownBtn.onclick = (e) => {
          e.stopPropagation();
          drawer.classList.toggle('show');
        };
        document.addEventListener('click', (e) => {
          if (!drawer.contains(e.target) && e.target !== breakdownBtn) {
            drawer.classList.remove('show');
          }
        });
      }

      // Sidebar Tab Switching
      const navItems = backdrop.querySelectorAll('.rzp-nav-item');
      navItems.forEach(btn => {
        btn.onclick = () => {
          const targetTab = btn.getAttribute('data-tab');
          this.switchTab(targetTab);
        };
      });

      // UPI Sub-segment switching (QR vs ID)
      const qrSubBtn = document.getElementById('rzp-upi-sub-qr');
      const idSubBtn = document.getElementById('rzp-upi-sub-id');
      const qrView = document.getElementById('rzp-upi-view-qr');
      const idView = document.getElementById('rzp-upi-view-id');

      if (qrSubBtn && idSubBtn) {
        qrSubBtn.onclick = () => {
          qrSubBtn.classList.add('active');
          idSubBtn.classList.remove('active');
          qrView.style.display = 'flex';
          idView.style.display = 'none';
        };
        idSubBtn.onclick = () => {
          idSubBtn.classList.add('active');
          qrSubBtn.classList.remove('active');
          qrView.style.display = 'none';
          idView.style.display = 'block';
        };
      }

      // UPI handle pill fast click
      backdrop.querySelectorAll('[data-vpa-suffix]').forEach(pill => {
        pill.onclick = () => {
          const suffix = pill.getAttribute('data-vpa-suffix');
          const input = document.getElementById('rzp-vpa-input');
          if (input) {
            const prefix = input.value.split('@')[0] || 'student';
            input.value = prefix + suffix;
          }
        };
      });

      // UPI App pickers
      backdrop.querySelectorAll('.rzp-app-pick').forEach(card => {
        card.onclick = () => {
          backdrop.querySelectorAll('.rzp-app-pick').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.selectedMethodName = `UPI - ${card.getAttribute('data-app')}`;
        };
      });

      // Card preset dropdown
      const presetSelect = document.getElementById('rzp-card-preset-select');
      if (presetSelect) {
        presetSelect.onchange = (e) => {
          this.applyCardPreset(e.target.value);
        };
      }

      // Live card input formatting & reflection
      const cardNumInput = document.getElementById('rzp-card-num-input');
      const cardExpInput = document.getElementById('rzp-card-exp-input');
      const cardNameInput = document.getElementById('rzp-card-name-input');

      if (cardNumInput) {
        cardNumInput.oninput = (e) => {
          let val = e.target.value.replace(/\D/g, '').substring(0, 16);
          let formatted = val.match(/.{1,4}/g)?.join(' ') || val;
          e.target.value = formatted;
          const display = document.getElementById('rzp-card-num-text');
          if (display) display.innerText = formatted || '•••• •••• •••• ••••';

          // Detect brand
          const brandBadge = document.getElementById('rzp-card-brand-badge');
          if (brandBadge) {
            if (val.startsWith('4')) {
              brandBadge.innerText = 'VISA';
              brandBadge.style.color = '#2b83ea';
            } else if (val.startsWith('5') || val.startsWith('2')) {
              brandBadge.innerText = 'MASTERCARD';
              brandBadge.style.color = '#f59e0b';
            } else if (val.startsWith('6')) {
              brandBadge.innerText = 'RUPAY';
              brandBadge.style.color = '#12b76a';
            } else {
              brandBadge.innerText = 'CARD';
              brandBadge.style.color = '#ffffff';
            }
          }
        };
      }

      if (cardExpInput) {
        cardExpInput.oninput = (e) => {
          let val = e.target.value.replace(/\D/g, '').substring(0, 4);
          if (val.length >= 2) val = val.substring(0, 2) + '/' + val.substring(2);
          e.target.value = val;
          const display = document.getElementById('rzp-card-exp-text');
          if (display) display.innerText = val || 'MM/YY';
        };
      }

      if (cardNameInput) {
        cardNameInput.oninput = (e) => {
          const display = document.getElementById('rzp-card-holder-text');
          if (display) display.innerText = (e.target.value || 'CARDHOLDER').toUpperCase();
        };
      }

      // Netbanking bank selection
      backdrop.querySelectorAll('.rzp-bank-card').forEach(b => {
        b.onclick = () => {
          backdrop.querySelectorAll('.rzp-bank-card').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          this.selectedBank = b.getAttribute('data-bank');
        };
      });

      // Wallet option selection
      backdrop.querySelectorAll('.rzp-wallet-option').forEach(w => {
        w.onclick = () => {
          backdrop.querySelectorAll('.rzp-wallet-option').forEach(x => {
            x.classList.remove('active');
            const radio = x.querySelector('input[type="radio"]');
            if (radio) radio.checked = false;
          });
          w.classList.add('active');
          const radio = w.querySelector('input[type="radio"]');
          if (radio) radio.checked = true;
          this.selectedWallet = w.getAttribute('data-wallet');
        };
      });

      // Top Sandbox Ribbon Tools
      const autoFillBtn = document.getElementById('rzp-autofill-btn');
      if (autoFillBtn) {
        autoFillBtn.onclick = () => {
          this.autoFillCurrentTab();
        };
      }

      const toggleOtpBtn = document.getElementById('rzp-toggle-otp-btn');
      if (toggleOtpBtn) {
        toggleOtpBtn.onclick = () => {
          this.showOtpScreen({ bankName: 'HDFC Bank SecurePay', method: 'Test OTP Flow' });
        };
      }

      const toggleFailBtn = document.getElementById('rzp-toggle-failure-btn');
      if (toggleFailBtn) {
        toggleFailBtn.onclick = () => {
          this.forceFailure = !this.forceFailure;
          toggleFailBtn.innerText = this.forceFailure ? '🔴 Fail Mode (ON)' : '⚠️ Test Decline';
          toggleFailBtn.classList.toggle('active', this.forceFailure);
        };
      }

      // Payment Trigger Buttons
      const btnSimulateQR = document.getElementById('rzp-btn-simulate-qr');
      if (btnSimulateQR) {
        btnSimulateQR.onclick = () => this.processPayment('UPI - PhonePe QR Scan');
      }

      const btnPayVpa = document.getElementById('rzp-btn-pay-vpa');
      if (btnPayVpa) {
        btnPayVpa.onclick = () => {
          const vpa = document.getElementById('rzp-vpa-input')?.value || 'student@upi';
          this.processPayment(`UPI (${vpa})`);
        };
      }

      const btnPayCard = document.getElementById('rzp-btn-pay-card');
      if (btnPayCard) {
        btnPayCard.onclick = () => {
          const num = document.getElementById('rzp-card-num-input')?.value || '';
          if (num.includes('0002') || this.forceFailure) {
            this.processPayment('Debit Card', { fail: true });
          } else if (num.startsWith('5') || this.options.testOtp) {
            this.showOtpScreen({ bankName: 'Verified by VISA / HDFC Bank', method: 'HDFC Credit Card' });
          } else {
            this.processPayment('Credit/Debit Card (Visa)');
          }
        };
      }

      const btnPayNb = document.getElementById('rzp-btn-pay-nb');
      if (btnPayNb) {
        btnPayNb.onclick = () => {
          this.showOtpScreen({ bankName: `${this.selectedBank} Bank NetBanking`, method: `Netbanking (${this.selectedBank})` });
        };
      }

      const btnPayWallet = document.getElementById('rzp-btn-pay-wallet');
      if (btnPayWallet) {
        btnPayWallet.onclick = () => this.processPayment(`Wallet (${this.selectedWallet.toUpperCase()})`);
      }

      const btnPayCampus = document.getElementById('rzp-btn-pay-campus');
      if (btnPayCampus) {
        btnPayCampus.onclick = () => this.processPayment('MU Student Meal Pass Balance');
      }

      const btnPayCounter = document.getElementById('rzp-btn-pay-counter');
      if (btnPayCounter) {
        btnPayCounter.onclick = () => this.processPayment('Pay on Counter (Cash/UPI)');
      }
    }

    switchTab(tabId) {
      this.activeTab = tabId;
      const backdrop = document.getElementById('rzp-sandbox-backdrop');
      if (!backdrop) return;

      backdrop.querySelectorAll('.rzp-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
      });

      backdrop.querySelectorAll('.rzp-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `rzp-panel-${tabId}`);
      });
    }

    applyCardPreset(type) {
      const numInput = document.getElementById('rzp-card-num-input');
      const expInput = document.getElementById('rzp-card-exp-input');
      const cvvInput = document.getElementById('rzp-card-cvv-input');
      const nameInput = document.getElementById('rzp-card-name-input');
      if (!numInput) return;

      if (type === 'visa_ok') {
        numInput.value = '4000 0012 3456 7890';
        expInput.value = '12/28';
        cvvInput.value = '123';
        nameInput.value = 'KABIR AHUJA';
        this.forceFailure = false;
      } else if (type === 'mc_otp') {
        numInput.value = '5123 4567 8901 2345';
        expInput.value = '11/27';
        cvvInput.value = '567';
        nameInput.value = 'KABIR AHUJA';
        this.forceFailure = false;
      } else if (type === 'rupay_ok') {
        numInput.value = '6071 2345 6789 0123';
        expInput.value = '09/29';
        cvvInput.value = '889';
        nameInput.value = 'KABIR AHUJA';
        this.forceFailure = false;
      } else if (type === 'fail_funds') {
        numInput.value = '4000 0000 0000 0002';
        expInput.value = '05/26';
        cvvInput.value = '000';
        nameInput.value = 'TEST DECLINE';
        this.forceFailure = true;
      }
      numInput.dispatchEvent(new Event('input'));
      expInput.dispatchEvent(new Event('input'));
      nameInput.dispatchEvent(new Event('input'));
    }

    autoFillCurrentTab() {
      if (this.activeTab === 'card') {
        this.applyCardPreset('visa_ok');
      } else if (this.activeTab === 'upi') {
        const vpa = document.getElementById('rzp-vpa-input');
        if (vpa) vpa.value = 'kabir.ahuja@okhdfcbank';
      }
    }

    startQRTimer() {
      if (this.qrTimerInterval) clearInterval(this.qrTimerInterval);
      this.qrTimerInterval = setInterval(() => {
        this.qrSecondsRemaining--;
        if (this.qrSecondsRemaining <= 0) {
          this.qrSecondsRemaining = 299;
        }
        const m = Math.floor(this.qrSecondsRemaining / 60);
        const s = this.qrSecondsRemaining % 60;
        const text = `0${m}:${s < 10 ? '0' : ''}${s}`;
        const el = document.getElementById('rzp-qr-countdown');
        if (el) el.innerText = text;
      }, 1000);
    }

    showOtpScreen({ bankName = 'HDFC Bank SecurePay', method = 'Card' }) {
      const slot = document.getElementById('rzp-modal-overlay-slot');
      if (!slot) return;

      slot.innerHTML = `
        <div class="rzp-overlay-state">
          <div class="rzp-otp-container">
            <div class="rzp-otp-bank-header">
              <div style="font-weight:700;font-size:14px;color:#004c8f">${bankName}</div>
              <div style="font-size:11px;color:#667085;font-weight:600">3D SECURE 2.0</div>
            </div>

            <div style="font-size:14px;font-weight:600;color:#1d2939;margin-bottom:4px">Enter One-Time Password</div>
            <div style="font-size:12px;color:#667085">
              OTP sent to registered mobile <b>+91 98*** **410</b> for transaction of <b>₹${this.inrAmount.toFixed(2)}</b>
            </div>

            <div class="rzp-otp-boxes">
              <input class="rzp-otp-digit" type="text" maxlength="1" value="7">
              <input class="rzp-otp-digit" type="text" maxlength="1" value="4">
              <input class="rzp-otp-digit" type="text" maxlength="1" value="2">
              <input class="rzp-otp-digit" type="text" maxlength="1" value="9">
              <input class="rzp-otp-digit" type="text" maxlength="1" value="1">
              <input class="rzp-otp-digit" type="text" maxlength="1" value="0">
            </div>

            <div style="font-size:11.5px;color:#2b83ea;margin-bottom:14px">
              ⚡ Sandbox Auto-Filled Test OTP (742910)
            </div>

            <button class="rzp-btn-pay" id="rzp-submit-otp-btn">
              Verify &amp; Confirm Payment
            </button>

            <button class="rzp-test-btn" id="rzp-cancel-otp-btn" style="margin-top:10px;width:100%;padding:8px">
              Cancel &amp; Return
            </button>
          </div>
        </div>
      `;

      const submitBtn = document.getElementById('rzp-submit-otp-btn');
      if (submitBtn) {
        submitBtn.onclick = () => {
          this.processPayment(method);
        };
      }

      const cancelBtn = document.getElementById('rzp-cancel-otp-btn');
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          slot.innerHTML = '';
        };
      }
    }

    async processPayment(methodName = 'UPI', { fail = false } = {}) {
      const slot = document.getElementById('rzp-modal-overlay-slot');
      if (!slot) return;

      // Stage 1: Dual-ring spinner (Connecting with bank)
      slot.innerHTML = `
        <div class="rzp-overlay-state">
          <div class="rzp-dual-ring-spinner"></div>
          <div style="font-size:16px;font-weight:700;color:#0c2340;margin-bottom:6px">
            Securing payment with bank...
          </div>
          <div style="font-size:12.5px;color:#667085;max-width:280px">
            Please do not press back or refresh. Encrypting transaction details via Razorpay...
          </div>
          <div style="font-size:11px;color:#2b83ea;margin-top:14px;font-weight:500">
            Method: ${methodName}
          </div>
        </div>
      `;

      await new Promise(r => setTimeout(r, 1400));

      const shouldFail = fail || this.forceFailure;

      if (shouldFail) {
        // Stage Failure
        slot.innerHTML = `
          <div class="rzp-overlay-state">
            <div class="rzp-danger-circle">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </div>
            <div style="font-size:18px;font-weight:700;color:#f04438;margin-bottom:6px">
              Payment Failed
            </div>
            <div style="font-size:12.5px;color:#667085;max-width:320px;line-height:1.5">
              The issuing bank declined this transaction (Error: <b>BAD_REQUEST_ERROR / INSUFFICIENT_FUNDS</b>). No money was debited.
            </div>

            <div style="display:flex;gap:10px;margin-top:20px;width:100%;max-width:320px">
              <button class="rzp-btn-pay" id="rzp-retry-payment-btn" style="margin:0;flex:1">
                🔄 Try Again
              </button>
              <button class="rzp-test-btn" id="rzp-dismiss-failure-btn" style="padding:10px 14px">
                Close
              </button>
            </div>
          </div>
        `;

        document.getElementById('rzp-retry-payment-btn').onclick = () => {
          this.forceFailure = false;
          slot.innerHTML = '';
        };
        document.getElementById('rzp-dismiss-failure-btn').onclick = () => {
          this.close();
          if (this.options.modal?.ondismiss) this.options.modal.ondismiss();
        };
        return;
      }

      // Stage Success
      const paymentId = 'pay_sbx_' + Math.random().toString(36).substring(2, 12);
      const signature = 'sig_sbx_' + Math.random().toString(36).substring(2, 16);
      const bankRef = 'RRN' + Math.floor(100000000000 + Math.random() * 900000000000);

      // Play audio confirmation chime!
      playRazorpayChime();

      // Verify payment with server
      try {
        await fetch('/api/payment/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpay_order_id: this.orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
            method: methodName
          })
        });
      } catch (_) {}

      slot.innerHTML = `
        <div class="rzp-overlay-state">
          <div class="rzp-success-circle">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <div style="font-size:18px;font-weight:700;color:#12b76a;margin-bottom:4px">
            Payment Successful!
          </div>
          <div style="font-size:13px;color:#475467">
            Paid <b>₹${this.inrAmount.toFixed(2)}</b> to ${this.options.name}
          </div>

          <div class="rzp-success-details">
            <div class="rzp-success-row">
              <span>Razorpay Payment ID</span>
              <b>${paymentId}</b>
            </div>
            <div class="rzp-success-row">
              <span>Order Reference</span>
              <b>${this.orderId}</b>
            </div>
            <div class="rzp-success-row">
              <span>Payment Mode</span>
              <span>${methodName}</span>
            </div>
            <div class="rzp-success-row">
              <span>Bank Ref / RRN</span>
              <span>${bankRef}</span>
            </div>
          </div>

          <button class="rzp-btn-pay success" id="rzp-btn-finish" style="max-width:280px">
            ✓ Done • View Canteen Token
          </button>
        </div>
      `;

      const finishAndNotify = () => {
        this.close();
        if (typeof this.options.handler === 'function') {
          this.options.handler({
            razorpay_payment_id: paymentId,
            razorpay_order_id: this.orderId,
            razorpay_signature: signature,
            method: methodName
          });
        }
      };

      const finishBtn = document.getElementById('rzp-btn-finish');
      if (finishBtn) finishBtn.onclick = finishAndNotify;

      // Auto-finish after 2 seconds if user doesn't click
      setTimeout(() => {
        if (this.isOpen) finishAndNotify();
      }, 2100);
    }

    handleDismiss() {
      if (confirm("Are you sure you want to cancel payment? Your order token will not be generated.")) {
        this.close();
        if (typeof this.options.modal?.ondismiss === 'function') {
          this.options.modal.ondismiss();
        }
      }
    }

    close() {
      this.isOpen = false;
      if (this.qrTimerInterval) {
        clearInterval(this.qrTimerInterval);
        this.qrTimerInterval = null;
      }
      const backdrop = document.getElementById('rzp-sandbox-backdrop');
      if (backdrop) {
        backdrop.classList.remove('rzp-open');
        setTimeout(() => backdrop.remove(), 260);
      }
    }
  }

  // Global Exports
  window.RazorpayCheckoutSandbox = {
    open: function(options) {
      const instance = new RazorpaySandboxModal(options);
      instance.open();
      return instance;
    }
  };

  // Also define standard window.Razorpay constructor for official drop-in compatibility
  window.Razorpay = function(options) {
    this.options = options;
    this.open = function() {
      return window.RazorpayCheckoutSandbox.open(this.options);
    };
  };

})(window);
