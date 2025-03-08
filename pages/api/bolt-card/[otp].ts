import { NextApiRequest, NextApiResponse } from "next"
import originalUrl from "original-url"
import {
  ApolloClient,
  ApolloLink,
  concat,
  gql,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"

import { GRAPHQL_URI_INTERNAL } from "../../../lib/config"

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
      fetchOptions: {
        timeout: 30000, // 30 seconds timeout
      },
    }),
  ),
  cache: new InMemoryCache(),
  defaultOptions: {
    mutate: {
      errorPolicy: 'all',
    },
  },
})

const PAIR_BOLT_CARD = gql`
  mutation PairCard($input: BoltCardPairInput!) {
    boltCardPair(input: $input) {
      errors {
        message
      }
      cardName
      k0
      k1
      k2
      k3
      k4
      lnurlwBase
      protocolName
      protocolVersion
    }
  }
`

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" })
  }

  try {
    const { otp } = req.query // Next.js puts path parameters in query

    if (!otp || Array.isArray(otp)) {
      return res.status(400).json({
        status: "ERROR",
        reason: "Invalid OTP parameter"
      })
    }

    // Get the base URL from the request
    const url = originalUrl(req)
    const baseUrl = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`
    
    console.log("Pairing Bolt card with:", { otp, baseUrl, graphqlUri: GRAPHQL_URI_INTERNAL })
    
    try {
      const { data, errors: gqlErrors } = await client.mutate({
        mutation: PAIR_BOLT_CARD,
        variables: {
          input: {
            otp,
            baseUrl
          },
        },
        context: {
          "x-real-ip": req.headers["x-real-ip"],
          "x-forwarded-for": req.headers["x-forwarded-for"],
        },
      })
      
      // Log GraphQL errors if any
      if (gqlErrors && gqlErrors.length) {
        console.error("GraphQL errors:", JSON.stringify(gqlErrors, null, 2))
        return res.status(400).json({
          status: "ERROR",
          reason: `GraphQL errors: ${gqlErrors.map(e => e.message).join(", ")}`
        })
      }
      
      // Check for application-level errors
      if (data?.boltCardPair?.errors && data.boltCardPair.errors.length) {
        console.error("Application errors:", JSON.stringify(data.boltCardPair.errors, null, 2))
        return res.status(400).json({
          status: "ERROR",
          reason: `Failed to pair Bolt card: ${data.boltCardPair.errors[0].message}`
        })
      }
      
      // If we got here, we should have valid data
      if (!data || !data.boltCardPair) {
        console.error("No data returned from GraphQL mutation")
        return res.status(500).json({
          status: "ERROR",
          reason: "No data returned from server"
        })
      }
      console.log("Bolt card pair response:", data.boltCardPair)
      return res.status(200).json({
        card_name: data.boltCardPair.cardName,
        id: "1",
        k0: data.boltCardPair.k0,
        k1: data.boltCardPair.k1,
        k2: data.boltCardPair.k2,
        k3: data.boltCardPair.k3,
        k4: data.boltCardPair.k4,
        lnurlw_base: data.boltCardPair.lnurlwBase,
        protocol_name: data.boltCardPair.protocolName,
        protocol_version: data.boltCardPair.protocolVersion,
      })
    } catch (gqlError: any) {
      console.error("Apollo client error:", gqlError)
      
      // Extract detailed error information if available
      let errorMessage = "GraphQL request failed"
      let errorDetails = null
      
      if (gqlError.networkError && gqlError.networkError.result && gqlError.networkError.result.errors) {
        errorDetails = gqlError.networkError.result.errors
        console.error("Detailed GraphQL errors:", JSON.stringify(errorDetails, null, 2))
        errorMessage = errorDetails.map((e: any) => e.message).join(", ")
      }
      
      return res.status(500).json({
        status: "ERROR",
        reason: errorMessage,
        details: errorDetails
      })
    }
  } catch (error: unknown) {
    console.error("Unexpected error:", error)
    return res.status(500).json({ 
      status: "ERROR",
      reason: error instanceof Error ? error.message : String(error) 
    })
  }
} 