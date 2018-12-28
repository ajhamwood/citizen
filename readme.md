# **Citizen** - a self-hosted smart contract platform

**A:** Look at this, another blockchain project. Who cares?

**B:** There are lots of blockchains already, it's true. This one implements smart contracts.

**A:** Like Ethereum or Cardano already do? You're 6 years too late, all the niches have already been taken.

**B:** Well, Ethereum has the issue that you never know when your transaction is going to be reset by the Ethereum Foundation, because one organisation holds the final key. You may say we have to at least trust the developers, but that isn't true either. We say, why not host the codebase itself as a distributed application? That way, all updates, and all contributing developers, can be subject to a transparency process that itself can be iterated upon. Only good code will get pushed, and only developers who listen to the community will be able to contribute. That's definitely an unfilled niche, as far as I can tell.

**A:** It's a nice idea. But smart contracts are always going to have bugs. What happens when a project on your chain loses $250M, and people start to abandon your platform?

**B:** You're right, bugs in general are unavoidable. So I think any project that pushes unit testing of contracts is great, and formal verification is even better. Especially when large sums of money are involved. We say, why not put that power in the hands of contract developers? Dependent typing, a feature which allows in-program formal verification, has been around for awhile, and it's not too hard to code once you wrap your head around it. Our virtual computer interprets a purpose-written dependently typed language called Katsuo, so you can confirm a contract is correct just by asking it to return the proof as a value.

**A:** This all sounds super theoretical. Where is the real world value? How will it make money for adopters?

**B:** While we aren't really in it for making bank, we take a leaf out of Steemit's playbook and issue micropayments for good contributions to the community. If you forge a block on the blockchain according to the rules, you get paid in a tradeable token. If you provide data warehousing or compute resources off-chain with good uptime, you get paid in a tradeable token. And all the tokens are subject to transparent economic management by subject-matter experts, the same way the developer community is. Why not run a web hosting service on our platform? The possibilities are endless.

**A:** Wow, okay... I don't believe any project would be able to do all that.

**B:** We're still in the very early stages of development, but the tech is out there. Why don't you have a look around, make some pull requests if you like? The virtual computer is actively being developed at https://github.com/ajhamwood/katsuo, and more detailed notes about the subsystems, roadmap etc are at https://github.com/ajhamwood/citizen-guidance. We're hungry for help :)
