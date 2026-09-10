/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    /**
     * Client-side navigation caches a dynamic route's payload for 30 seconds by
     * default. History and Documents are meant to show what the database holds
     * right now, so clicking History straight after asking a question showed the
     * list as it was before the answer landed.
     *
     * Zero means every navigation refetches. These two pages are small database
     * reads, so there is nothing to protect by caching them.
     */
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
