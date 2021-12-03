import Navbar from "react-bootstrap/Navbar"
import Container from "react-bootstrap/Container"
import Image from "react-bootstrap/Image"

function Header() {
  return (
    <Navbar bg="dark">
      <Container>
        <Navbar.Brand href="https://bitcoinjungle.app">
          <Image src={"/BJLogo.png"} height={50} rounded />{" "}
        </Navbar.Brand>
      </Container>
    </Navbar>
  )
}

export default Header
