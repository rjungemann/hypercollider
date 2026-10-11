// HyperCollider HCNetAddrZeroconf.sc
// mDNS/Bonjour service discovery support for NetAddr
// Phase B2: sclang-side browsing
//
// The registry is its own class because a class extension (`+ NetAddr { ... }`)
// cannot declare a classvar. Method names must not start with `_` (that is the
// primitive-call syntax), so the host-side entry points are zeroconfFound and
// zeroconfLost, called by cli/hclang.js and cli/hclang_repl.js.

HCZeroconf {
	classvar <services;

	*initClass {
		services = Dictionary.new;
	}
}

+ NetAddr {
	*zeroconfServices {
		^HCZeroconf.services
	}

	*zeroconfFound { |name, host, port|
		var addr = NetAddr(host, port);
		HCZeroconf.services.put(name.asSymbol, addr);
		this.changed(\serviceFound, name, addr);
		// If a server is registered with this name, update its address automatically
		Server.all.do { |srv|
			if (srv.name.asString == name) { srv.addr = addr }
		};
		("mDNS: found " ++ name ++ " at " ++ host ++ ":" ++ port).postln;
	}

	*zeroconfLost { |name|
		HCZeroconf.services.removeAt(name.asSymbol);
		this.changed(\serviceLost, name);
		("mDNS: lost " ++ name).postln;
	}

	*findServiceNamed { |name, action|
		// Synchronous: return current address if already known
		var existing = HCZeroconf.services.at(name.asSymbol);
		if (existing.notNil) { action.value(existing); ^existing };
		// Async: wait for the next serviceFound notification
		this.addDependant({ |changer, what, svcName, addr|
			if (what == \serviceFound and: { svcName == name }) {
				action.value(addr);
				this.removeDependant(thisFunction);
			}
		});
		^nil
	}
}
