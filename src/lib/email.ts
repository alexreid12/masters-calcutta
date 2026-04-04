import { Resend } from 'resend';

// Lazily instantiate so the module can be imported even when the key isn't set
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendOutbidEmail({
  to,
  playerName,
  golferName,
  previousBid,
  newBid,
  poolName,
  biddingUrl,
}: {
  to: string;
  playerName: string;
  golferName: string;
  previousBid: number;
  newBid: number;
  poolName: string;
  biddingUrl: string;
}): Promise<void> {
  if (!resend) return; // not configured — skip silently

  try {
    await resend.emails.send({
      // Use onboarding@resend.dev for testing; swap in a verified domain for production.
      from: 'Masters Calcutta <onboarding@resend.dev>',
      to,
      subject: `You've been outbid on ${golferName}!`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #006747; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: #d4af37; margin: 0; font-size: 24px;">Masters Calcutta</h1>
          </div>
          <div style="padding: 24px; background: #f5f0e1; border-radius: 0 0 8px 8px;">
            <p style="font-size: 16px; color: #333;">Hey ${playerName},</p>
            <p style="font-size: 16px; color: #333;">
              Someone just outbid you on <strong>${golferName}</strong> in the <strong>${poolName}</strong> pool.
            </p>
            <div style="background: white; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center;">
              <div style="color: #999; font-size: 14px;">Your bid</div>
              <div style="font-size: 20px; color: #999; text-decoration: line-through;">$${previousBid}</div>
              <div style="color: #999; font-size: 14px; margin-top: 12px;">New high bid</div>
              <div style="font-size: 28px; font-weight: bold; color: #006747;">$${newBid}</div>
            </div>
            <a href="${biddingUrl}" style="display: block; text-align: center; background: #d4af37; color: #004d35; padding: 14px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin-top: 16px;">
              Place a New Bid →
            </a>
            <p style="font-size: 12px; color: #999; margin-top: 20px; text-align: center;">
              You're receiving this because you placed a bid in ${poolName}.
            </p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error('[email] sendOutbidEmail failed:', err);
  }
}
