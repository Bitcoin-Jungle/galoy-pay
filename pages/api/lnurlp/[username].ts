import crypto from "crypto"
import originalUrl from "original-url"
import {
  ApolloClient,
  ApolloLink,
  concat,
  gql,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import type { NextApiRequest, NextApiResponse } from "next"

import { GRAPHQL_URI_INTERNAL, NOSTR_PUBKEY } from "../../../lib/config"

const ipForwardingMiddleware = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      "x-real-ip": operation.getContext()["x-real-ip"],
      "x-forwarded-for": operation.getContext()["x-forwarded-for"],
    },
  }))

  return forward(operation)
})

const client = new ApolloClient({
  link: concat(
    ipForwardingMiddleware,
    new HttpLink({
      uri: GRAPHQL_URI_INTERNAL,
    }),
  ),
  cache: new InMemoryCache(),
})

const USER_WALLET_ID = gql`
  query userDefaultWalletId($username: Username!) {
    userDefaultWalletId(username: $username)
  }
`

const LNURL_INVOICE = gql`
  mutation lnInvoiceCreateOnBehalfOfRecipient($walletId: WalletId!, $amount: SatAmount!, $memo: Memo!) {
    mutationData: lnInvoiceCreateOnBehalfOfRecipient(
      input: { recipientWalletId: $walletId, amount: $amount, memo: $memo }
    ) {
      errors {
        message
      }
      invoice {
        paymentRequest
      }
    }
  }
`

export default async function (req: NextApiRequest, res: NextApiResponse) {
  const { username, amount, comment } = req.query
  let { nostr } = req.query
  const url = originalUrl(req)
  const userAgent = req.headers['user-agent']

  console.log({ headers: req.headers }, "request to NextApiRequest")

  let walletId

  try {
    const { data } = await client.query({
      query: USER_WALLET_ID,
      variables: { username },
      context: {
        "x-real-ip": req.headers["x-real-ip"],
        "x-forwarded-for": req.headers["x-forwarded-for"],
      },
    })

    walletId = data.userDefaultWalletId
  } catch (err) {
    return res.json({
      status: "ERROR",
      reason: `Couldn't find user '${username}'.`,
    })
  }

  const metadata = JSON.stringify([
    ["text/plain", `Payment to ${username}`],
    ["text/identifier", `${username}@${url.hostname}`],
  ])

  if (amount) {
    if (Array.isArray(amount)) {
      throw new Error("Invalid request")
    }
    // second call, return invoice
    const amountSats = Math.round(parseInt(amount, 10) / 1000)
    if ((amountSats * 1000).toString() !== amount) {
      return res.json({
        status: "ERROR",
        reason: "Millisatoshi amount is not supported, please send a value in full sats.",
      })
    }

    try {
      // LEE :: Hack this to prevent old builds from using LNURL, only for Bitcoin Jungle Builds < 303
      if(userAgent && userAgent.indexOf('Bitcoin%20Jungle') != -1) {
        const userAgentPieces = userAgent.split(' ')
        const bitcoinJunglePiece = userAgentPieces[0]
        const bitcoinJunglePieces = bitcoinJunglePiece.split('/')

        if(bitcoinJunglePieces.length > 1) {
          const buildNumber = parseInt(bitcoinJunglePieces[1])

          if(buildNumber > 0 && buildNumber < 303) {
            throw new Error("Please update your app version.")
          }
        }
      }

      let description = ""

      if(nostr) {
        try {
          // @ts-ignore
          let nostrObj = JSON.parse(nostr)
          if(nostrObj && nostrObj.tags && nostrObj.tags[2] && nostrObj.tags[2][0] === 'relays') {
            nostrObj.tags[2] = nostrObj.tags[2].slice(0, 3)
          }
          // @ts-ignore
          nostr = JSON.stringify(nostrObj)

        } catch(e) {
          console.log(e)
        }
        // @ts-ignore
        description = nostr
      } else if(comment) {
        // @ts-ignore
        description = comment
      }

      const {
        data: {
          mutationData: { errors, invoice },
        },
      } = await client.mutate({
        mutation: LNURL_INVOICE,
        variables: {
          walletId,
          amount: amountSats,
          memo: description,
        },
      })

      if (errors && errors.length) {
        console.log("error getting invoice", errors)
        return res.json({
          status: "ERROR",
          reason: `Failed to get invoice: ${errors[0].message}`,
        })
      }

      res.json({
        pr: invoice.paymentRequest,
        routes: [],
      })
    } catch (err: unknown) {
      console.log("unexpected error getting invoice", err)
      res.json({
        status: "ERROR",
        reason: err instanceof Error ? err.message : "unexpected error",
      })
    }
  } else {
    // first call
    res.json({
      callback: url.full,
      minSendable: 1000,
      maxSendable: 500000000,
      metadata: metadata,
      tag: "payRequest",
      allowsNostr: true,
      nostrPubkey: NOSTR_PUBKEY,
    })
  }
}
