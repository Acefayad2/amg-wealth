/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/matchups",
  assetPrefix: "/matchups",
  trailingSlash: true,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
