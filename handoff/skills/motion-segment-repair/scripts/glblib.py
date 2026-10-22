import struct, json, math
def load(path):
    d=open(path,'rb').read()
    l=struct.unpack('<I',d[12:16])[0]
    j=json.loads(d[20:20+l])
    off=20+l
    bl=struct.unpack('<I',d[off:off+4])[0]
    binoff=off+8
    return d,j,binoff,bl
def acc(j,d,binoff,i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    n={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
    start=binoff+bv.get('byteOffset',0)+a.get('byteOffset',0)
    return a, bv, start, n
def read(j,d,binoff,i):
    a,bv,s,n=acc(j,d,binoff,i)
    if a['componentType']==5122:
        vals=struct.unpack('<%dh'%(a['count']*n), d[s:s+a['count']*n*2])
        vals=[max(v/32767.0,-1.0) for v in vals]
    else:
        vals=struct.unpack('<%df'%(a['count']*n), d[s:s+a['count']*n*4])
    return [tuple(vals[k*n:(k+1)*n]) for k in range(a['count'])]
def write(j,d,binoff,i,rows):
    """d must be bytearray; rows are normalised-int16 VEC4 (componentType 5122)"""
    a,bv,s,n=acc(j,d,binoff,i)
    assert a['componentType']==5122
    for k,row in enumerate(rows):
        struct.pack_into('<4h',d,s+k*8,*[max(-32767,min(32767,int(round(c*32767)))) for c in row])
def qmul(a,b):
    x1,y1,z1,w1=a;x2,y2,z2,w2=b
    return (w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2)
def qconj(q): return (-q[0],-q[1],-q[2],q[3])
def qrot(q,v):
    p=qmul(qmul(q,(v[0],v[1],v[2],0)),qconj(q)); return p[:3]
def qnorm(q):
    n=math.sqrt(sum(c*c for c in q)); return tuple(c/n for c in q)
def slerp(a,b,t):
    d=sum(x*y for x,y in zip(a,b))
    if d<0: b=tuple(-c for c in b); d=-d
    if d>0.9995: return qnorm(tuple(x+(y-x)*t for x,y in zip(a,b)))
    th=math.acos(d); s=math.sin(th)
    A=math.sin((1-t)*th)/s; B=math.sin(t*th)/s
    return qnorm(tuple(A*x+B*y for x,y in zip(a,b)))
