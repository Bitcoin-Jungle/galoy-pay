module.exports = {
  rewrites() {
    return [
      { source: "/.well-known/lnurlp/:username", destination: "/api/lnurlp/:username" },
    ]
  },
  async headers() {
    return [
      {
        source: '/.well-known/lnurlp/:username',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'OPTIONS,GET',
          }
        ],
      },
    ]
  },
}
