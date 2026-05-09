+Server {
	asTarget { ^this.defaultGroup }
	asNodeID { ^0 }
}

+Node {
	asTarget { ^this }
	asNodeID { ^nodeID }
}

+Nil {
	asTarget {
		var server = Server.default;
		if(server.isNil) {
			Error("Server.default is nil; cannot resolve target").throw;
			^this
		};
		^server.asTarget
	}
	asNodeID { ^this }
}

+Integer {
	asTarget {
		var server = Server.default;
		if(server.isNil) {
			Error("Server.default is nil; cannot resolve integer target").throw;
			^this
		};
		^Group.basicNew(server, this)
	}
	asNodeID { ^this }
}
