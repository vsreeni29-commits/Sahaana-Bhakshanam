export function Policies() {
  return (
    <div className="page policies">
      <header className="site-header">
        <a href="/" className="brand">
          <span className="brand-mark" aria-hidden>🍃</span> Sahaana Bhakshanam
        </a>
      </header>
      <main className="policy-body">
        <h1>Policies</h1>
        <p className="muted">
          These policies are placeholders pending the owner&rsquo;s final legal and business
          details (FSSAI registration, GST where applicable, exact service radius). They must be
          completed before commercial launch.
        </p>
        <section>
          <h2>Privacy</h2>
          <p>
            We collect only what is needed to prepare and deliver your order: your mobile number
            (verified by OTP), your name, and your delivery address. We never sell your data.
            Payment happens only at your doorstep — no card or UPI details are collected online.
          </p>
        </section>
        <section>
          <h2>Cancellations &amp; refunds</h2>
          <p>
            Orders can be cancelled by contacting the kitchen before the meal session&rsquo;s
            cutoff. Since no money is collected online, there is nothing to refund online; any
            adjustment is settled directly with the kitchen.
          </p>
        </section>
        <section>
          <h2>Food &amp; service</h2>
          <p>
            Sahaana Bhakshanam is a single home kitchen serving pure-vegetarian Tamil Brahmin
            Iyer food — no meat, fish or eggs, ever. Delivery is limited to the kitchen&rsquo;s
            service area and each meal session has a fixed ordering cutoff and delivery window.
          </p>
          <p className="muted">FSSAI registration number: to be added before launch.</p>
        </section>
        <a className="btn ghost" href="/">← Back to the kitchen</a>
      </main>
    </div>
  );
}
