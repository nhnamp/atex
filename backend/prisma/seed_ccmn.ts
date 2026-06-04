import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const mcqQuestions = [
  // LO1: Models & Basic Concepts
  { q: "Mạng máy tính là gì?", options: ["Hệ thống các máy tính kết nối với nhau để chia sẻ tài nguyên và thông tin", "Hệ thống các chương trình phần mềm", "Một loại máy tính siêu cấp", "Mạng lưới cáp quang internet"], ans: "Hệ thống các máy tính kết nối với nhau để chia sẻ tài nguyên và thông tin", diff: "EASY", lo: "LO1" },
  { q: "Mô hình OSI có bao nhiêu tầng?", options: ["5", "6", "7", "4"], ans: "7", diff: "EASY", lo: "LO1" },
  { q: "Tầng nào trong mô hình OSI chịu trách nhiệm định tuyến (routing)?", options: ["Tầng Data Link", "Tầng Network", "Tầng Transport", "Tầng Application"], ans: "Tầng Network", diff: "MEDIUM", lo: "LO1" },
  { q: "Giao thức IP hoạt động ở tầng nào của mô hình TCP/IP?", options: ["Application", "Transport", "Internet", "Network Access"], ans: "Internet", diff: "MEDIUM", lo: "LO1" },
  { q: "Trong mô hình OSI, tầng nào biến đổi dữ liệu thành các bit 0 và 1 để truyền trên đường truyền vật lý?", options: ["Physical", "Data Link", "Network", "Transport"], ans: "Physical", diff: "EASY", lo: "LO1" },
  { q: "Đơn vị dữ liệu (PDU) tại tầng Transport được gọi là gì?", options: ["Frame", "Packet", "Segment / Datagram", "Bit"], ans: "Segment / Datagram", diff: "MEDIUM", lo: "LO1" },
  { q: "Định dạng dữ liệu nào liên quan trực tiếp đến tầng Data Link?", options: ["Frame", "Packet", "Segment", "Data"], ans: "Frame", diff: "EASY", lo: "LO1" },
  { q: "Khẳng định nào ĐÚNG khi nói về mô hình TCP/IP?", options: ["Chỉ có 4 tầng: Application, Transport, Internet, Network Access", "Có 7 tầng như OSI", "Không hỗ trợ giao thức định tuyến", "Là mô hình lý thuyết, không được sử dụng thực tế"], ans: "Chỉ có 4 tầng: Application, Transport, Internet, Network Access", diff: "MEDIUM", lo: "LO1" },
  
  // LO2: Application & Protocols
  { q: "Giao thức nào dùng để duyệt web an toàn?", options: ["HTTP", "HTTPS", "FTP", "SMTP"], ans: "HTTPS", diff: "EASY", lo: "LO2" },
  { q: "Cổng (port) mặc định của giao thức HTTP là bao nhiêu?", options: ["80", "443", "21", "25"], ans: "80", diff: "EASY", lo: "LO2" },
  { q: "DNS có vai trò gì trong mạng máy tính?", options: ["Chuyển đổi tên miền thành địa chỉ IP", "Cấp phát IP động", "Định tuyến luồng dữ liệu", "Mã hóa dữ liệu"], ans: "Chuyển đổi tên miền thành địa chỉ IP", diff: "MEDIUM", lo: "LO2" },
  { q: "Giao thức nào sau đây dùng để gửi email?", options: ["POP3", "IMAP", "SMTP", "SNMP"], ans: "SMTP", diff: "MEDIUM", lo: "LO2" },
  { q: "DHCP thực hiện chức năng gì?", options: ["Cấp phát địa chỉ IP tự động cho các thiết bị", "Dịch tên miền thành IP", "Định tuyến các gói tin IP", "Lọc các gói tin độc hại"], ans: "Cấp phát địa chỉ IP tự động cho các thiết bị", diff: "MEDIUM", lo: "LO2" },
  { q: "Lệnh PING sử dụng giao thức nào để hoạt động?", options: ["TCP", "UDP", "ICMP", "IGMP"], ans: "ICMP", diff: "HARD", lo: "LO2" },
  { q: "FTP sử dụng hai cổng nào để hoạt động?", options: ["20 và 21", "80 và 443", "25 và 110", "67 và 68"], ans: "20 và 21", diff: "HARD", lo: "LO2" },
  
  // LO3: Transport & Network Layer
  { q: "Đặc điểm nào sau đây là của giao thức TCP?", options: ["Truyền dữ liệu tin cậy, có kết nối", "Truyền dữ liệu nhanh, không kết nối", "Không kiểm tra lỗi", "Chỉ dùng cho video streaming"], ans: "Truyền dữ liệu tin cậy, có kết nối", diff: "EASY", lo: "LO3" },
  { q: "Giao thức UDP thường được sử dụng cho ứng dụng nào?", options: ["Tải file (FTP)", "Duyệt web (HTTP)", "Gửi email (SMTP)", "Stream video, gọi thoại"], ans: "Stream video, gọi thoại", diff: "MEDIUM", lo: "LO3" },
  { q: "Quá trình thiết lập kết nối của TCP còn được gọi là gì?", options: ["Three-way handshake (Bắt tay 3 bước)", "Four-way handshake", "Sliding window", "Congestion control"], ans: "Three-way handshake (Bắt tay 3 bước)", diff: "MEDIUM", lo: "LO3" },
  { q: "Địa chỉ IPv4 có kích thước bao nhiêu bit?", options: ["32 bit", "64 bit", "128 bit", "256 bit"], ans: "32 bit", diff: "EASY", lo: "LO3" },
  { q: "Địa chỉ IPv6 có kích thước bao nhiêu bit?", options: ["32 bit", "64 bit", "128 bit", "256 bit"], ans: "128 bit", diff: "EASY", lo: "LO3" },
  { q: "Địa chỉ IP nào sau đây là địa chỉ Loopback (localhost) chuẩn trong IPv4?", options: ["192.168.1.1", "10.0.0.1", "127.0.0.1", "172.16.0.1"], ans: "127.0.0.1", diff: "MEDIUM", lo: "LO3" },
  { q: "Subnet mask /24 tương ứng với giá trị nhị phân nào?", options: ["255.0.0.0", "255.255.0.0", "255.255.255.0", "255.255.255.255"], ans: "255.255.255.0", diff: "MEDIUM", lo: "LO3" },
  { q: "Thuật toán định tuyến nào sau đây thuộc loại Link-State?", options: ["RIP (Routing Information Protocol)", "OSPF (Open Shortest Path First)", "BGP (Border Gateway Protocol)", "EIGRP"], ans: "OSPF (Open Shortest Path First)", diff: "HARD", lo: "LO3" },
  
  // LO4: Data Link & Physical Layer
  { q: "Địa chỉ MAC có kích thước bao nhiêu bit?", options: ["32 bit", "48 bit", "64 bit", "128 bit"], ans: "48 bit", diff: "MEDIUM", lo: "LO4" },
  { q: "Thiết bị Switch hoạt động ở tầng nào của OSI?", options: ["Physical", "Data Link", "Network", "Transport"], ans: "Data Link", diff: "EASY", lo: "LO4" },
  { q: "Thiết bị Router hoạt động ở tầng nào của OSI?", options: ["Physical", "Data Link", "Network", "Transport"], ans: "Network", diff: "EASY", lo: "LO4" },
  { q: "Giao thức ARP thực hiện chức năng gì?", options: ["Tìm địa chỉ IP từ địa chỉ MAC", "Tìm địa chỉ MAC từ địa chỉ IP", "Định tuyến gói tin", "Chống vòng lặp mạng"], ans: "Tìm địa chỉ MAC từ địa chỉ IP", diff: "HARD", lo: "LO4" },
  { q: "Topo mạng dạng hình sao (Star Topology) cần thiết bị trung tâm nào?", options: ["Hub hoặc Switch", "Chỉ cáp mạng", "Repeater", "Không cần thiết bị trung tâm"], ans: "Hub hoặc Switch", diff: "EASY", lo: "LO4" },
  { q: "Công nghệ mạng nội bộ phổ biến nhất hiện nay là gì?", options: ["Token Ring", "FDDI", "Ethernet", "ATM"], ans: "Ethernet", diff: "EASY", lo: "LO4" },
  { q: "Cáp quang sử dụng nguyên lý nào để truyền dữ liệu?", options: ["Điện từ trường", "Phản xạ toàn phần ánh sáng", "Sóng vô tuyến", "Tần số vô tuyến"], ans: "Phản xạ toàn phần ánh sáng", diff: "MEDIUM", lo: "LO4" }
];

const essayQuestions = [
  // LO1
  {
    q: "Trình bày cấu trúc và chức năng các tầng trong mô hình TCP/IP. Tại sao mô hình TCP/IP lại phổ biến hơn OSI trong thực tế mạng Internet?",
    ans: "Mô hình TCP/IP bao gồm 4 tầng chính: Application, Transport, Internet, và Network Access. (30%)\n\nMỗi tầng đảm nhận chức năng riêng biệt: Tầng Application cung cấp các giao thức dịch vụ cho người dùng (như HTTP, FTP); Tầng Transport (TCP/UDP) xử lý thiết lập kết nối và truyền nhận dữ liệu end-to-end; Tầng Internet (IP) định tuyến gói tin qua các mạng khác nhau; Tầng Network Access xử lý giao tiếp vật lý với phần cứng mạng. (30%)\n\nNếu so sánh với OSI, Tầng Application của TCP/IP bao gộp cả 3 tầng (Application, Presentation, Session) của OSI; Tầng Transport và Internet tương đương với Transport và Network của OSI; Tầng Network Access bao gộp Data Link và Physical. (20%)\n\nTrong thực tế Internet, mô hình TCP/IP phổ biến hơn OSI vì TCP/IP được phát triển thực tiễn cùng với dự án ARPANET (tiền thân của Internet). Nó mang tính ứng dụng cao, cấu trúc mở, ít tính lý thuyết nặng nề và phức tạp như thiết kế của OSI. (20%)",
    diff: "MEDIUM", lo: "LO1"
  },
  {
    q: "Phân tích sự khác biệt cơ bản giữa mạng LAN, MAN và WAN. Trình bày một ví dụ ứng dụng thực tiễn của từng loại.",
    ans: "Mạng LAN (Local Area Network) là mạng kết nối thiết bị trong phạm vi hẹp như một tòa nhà. Mạng MAN (Metropolitan Area Network) mở rộng phạm vi ra quy mô một thành phố. Mạng WAN (Wide Area Network) trải dài ở khoảng cách địa lý rất lớn, có thể giữa các quốc gia hoặc toàn cầu. (30%)\n\nVề công nghệ và tốc độ: LAN thường sử dụng Ethernet/Wi-Fi với tốc độ truyền dẫn rất cao và độ trễ thấp. MAN sử dụng cáp quang hoặc vi vây băng thông rộng. WAN sử dụng các đường truyền viễn thông phức tạp, vệ tinh hoặc cáp quang biển, tốc độ tổng thể có thể rất lớn nhưng độ trễ sẽ cao hơn so với LAN. (30%)\n\nVí dụ điển hình cho mạng LAN là mạng nội bộ trong một công ty hoặc trường học để chia sẻ máy in và dữ liệu máy chủ nội bộ. Đối với MAN, ví dụ là mạng liên kết các chi nhánh của ngân hàng trong cùng một tỉnh hoặc thành phố. (20%)\n\nĐối với mạng WAN, ví dụ tiêu biểu nhất chính là mạng lưới Internet toàn cầu, kết nối hàng tỷ thiết bị trên phạm vi quốc tế vượt qua các đại dương. (20%)",
    diff: "EASY", lo: "LO1"
  },
  {
    q: "Mô tả chi tiết quá trình đóng gói dữ liệu (Data Encapsulation) qua từng tầng của mô hình OSI khi gửi đi.",
    ans: "Đóng gói dữ liệu (Data Encapsulation) là quá trình mà ở mỗi tầng của mô hình OSI khi dữ liệu đi từ trên xuống, nó sẽ được bọc thêm các thông tin điều khiển (header/trailer) cần thiết để đảm bảo việc truyền tải chính xác đến đích. (25%)\n\nBắt đầu từ tầng Application, Presentation và Session, dữ liệu người dùng được tạo ra định dạng chuẩn (gọi là Data). Khi xuống tầng Transport, hệ thống sẽ cắt dữ liệu thành các khối nhỏ hơn và thêm Transport Header (chứa Source Port, Destination Port) tạo thành các Segment (đối với TCP) hoặc Datagram (đối với UDP). (25%)\n\nTiếp theo, truyền xuống tầng Network, thiết bị sẽ thêm Network Header (chứa Source IP, Destination IP) vào Segment để định tuyến. Lúc này khối dữ liệu được gọi là Packet. (25%)\n\nCuối cùng, chuyển xuống tầng Data Link, hệ thống bọc thêm thông tin là Frame Header (chứa MAC address) và Frame Trailer (chứa thông tin kiểm tra lỗi FCS), gọi là Frame. Cuối cùng, tại tầng Physical, Frame được mã hoá thành các chuỗi bits (0 và 1) để truyền dưới dạng tín hiệu điện, quang, hoặc sóng vô tuyến. (25%)",
    diff: "HARD", lo: "LO1"
  },
  {
    q: "Hãy nêu định nghĩa giao thức mạng (Network Protocol). Kể tên ít nhất 3 yếu tố quan trọng mà một giao thức mạng phải định nghĩa.",
    ans: "Giao thức mạng (Network Protocol) là tập hợp các bộ quy tắc, quy ước tiêu chuẩn mà các thiết bị mạng cần tuân theo để có thể giao tiếp, trao đổi thông tin với nhau một cách thống nhất và không xảy ra lỗi định dạng. (30%)\n\nYếu tố quan trọng thứ nhất là Cú pháp (Syntax). Nó định nghĩa cấu trúc hoặc định dạng của khối dữ liệu được truyền đi, cho biết phần nào chứa dữ liệu điều khiển, phần nào là dữ liệu người dùng và kích thước từng bộ phận. (20%)\n\nYếu tố quan trọng thứ hai là Ngữ nghĩa (Semantics). Nó mô tả ý nghĩa chi tiết của từng thành phần điều khiển trong bản tin, qua đó xác định cách thiết bị nhận phản hồi, kiểm soát đường truyền hoặc xử lý lỗi phát sinh. (25%)\n\nYếu tố quan trọng thứ ba là Thời gian (Timing). Yếu tố này đồng bộ hóa việc truyền nhận, kiểm soát tốc độ gửi dữ liệu để không làm quá tải bên nhận và xác định chính xác thời điểm các mảnh dữ liệu cần được phản hồi. (25%)",
    diff: "MEDIUM", lo: "LO1"
  },
  {
    q: "Trình bày sự khác biệt giữa chuyển mạch kênh (Circuit Switching) và chuyển mạch gói (Packet Switching). Internet hiện nay dùng kỹ thuật nào?",
    ans: "Trong chuyển mạch kênh (Circuit Switching), một đường truyền kết nối vật lý hoặc ảo chuyên dụng sẽ được thiết lập, cấp phát độc quyền và duy trì trong suốt phiên giao tiếp giữa hai bên. Khi phiên kết nối này đang diễn ra, dung lượng đường truyền bị chiếm giữ hoàn toàn bất kể có dữ liệu truyền hay không. (30%)\n\nNgược lại, với chuyển mạch gói (Packet Switching), dữ liệu được băm nhỏ thành các gói (packet) có gán địa chỉ đích. Các gói này độc lập di chuyển qua các node trong mạng, có thể đi theo nhiều đường khác nhau và được lắp ráp lại ở đích. Tài nguyên trên đường đi được chia sẻ cho nhiều người dùng cùng lúc. (30%)\n\nChuyển mạch kênh cung cấp độ trễ ổn định và không tắc nghẽn giữa chừng, nhưng lại hao phí tài nguyên rảnh rỗi. Chuyển mạch gói hiệu quả hơn nhiều trong việc tận dụng tối đa băng thông mạng, linh hoạt chống mất quyền điều khiển nếu một node trung gian bị đứt, dù độ trễ có thể biến động. (20%)\n\nMạng Internet ngày nay sử dụng phương pháp Chuyển mạch gói (Packet Switching). Lựa chọn này là vì tính chất mạng linh hoạt, có thể tối ưu tài nguyên chia sẻ cho hàng tỷ đồ dùng cùng lúc thay vì giữ đường truyền riêng tốn kém. (20%)",
    diff: "MEDIUM", lo: "LO1"
  },
  
  // LO2
  {
    q: "Giải thích cơ chế hoạt động của giao thức DHCP trong mạng. Liệt kê 4 bước của quá trình cấp phát IP (DORA).",
    ans: "Giao thức DHCP (Dynamic Host Configuration Protocol) có mạng nhiệm vụ cung cấp các địa chỉ IP và thông tin cấu hình mạng một cách tự động, giúp quản trị viên không phải cấu hình gán IP bằng tay trên từng thiết bị mới kết nối vào mạng. (20%)\n\nBước thứ 1 là DHCP Discover: Khi thiết bị di động (Client) vừa kết nối, nó sẽ gửi bản tin broadcast để dò tìm xem có Server DHCP nào đang hoạt động và đáp ứng không. Bước 2 là DHCP Offer: Các Server DHCP nhận được Discover sẽ hồi đáp đề nghị cấp phát một địa chỉ IP có sẵn và các thông số mạng đi kèm. (30%)\n\nBước thứ 3 là DHCP Request: Client sẽ chọn một Offer (thường là cái đầu tiên tới), và phản hồi lại server bằng một request ghi nhận đồng ý dùng địa chỉ đó. Bước 4 là DHCP ACK: Server cuối cùng gửi gói ACK xác nhận chính thức khóa và cấp gán địa chỉ IP đó cho Client. (30%)\n\nThời gian DHCP gán IP cho client được gọi là chu kỳ Lease Time (thời gian cho thuê). Sau khi hết nửa chu kỳ, Client tự động xin gia hạn với Server; nếu hết thời gian thuê thiết bị sẽ phải giải phóng IP đó về nhóm dùng chung. (20%)",
    diff: "HARD", lo: "LO2"
  },
  {
    q: "Trình bày chi tiết vai trò của hệ thống tên miền (DNS). Phân tích quá trình phân giải một tên miền (VD: google.com) ra địa chỉ IP.",
    ans: "Hệ thống tên miền DNS đóng vai trò như một danh bạ điện thoại của Internet, chuyển đổi các tên miền thân thiện, dễ nhớ với con người (như google.com) thành địa chỉ IP (như 142.250.190.46) để máy tính trực tiếp nhận diện và kết nối với nhau. (20%)\n\nKhi người dùng nhập tên miền, hệ thống trước hết sẽ rà soát Local Cache có trên trình duyệt (Browser cache) hoặc hệ điều hành (OS Cache/Host file). Nếu có lịch sử sẵn, nó dừng ngay và tải trang. (20%)\n\nNếu cache trong máy không có, hệ điều hành sẽ chuyển truy vấn tới Recursive Resolver DNS do hệ thống mạng nội bộ hay nhà mạng (ISP) cấp. Truy vấn này sẽ đi tới máy chủ Root, rồi tiếp tục lấy đường dẫn đến các máy chủ TLD (Top-level Domain như .com). (30%)\n\nTừ máy chủ TLD, truy vấn đi tiếp tới máy chủ Authoritative của tên miền cụ thể (google.com). Authoritative Server nắm giữ bản ghi trực tiếp và trả về chính xác địa chỉ IP cho máy khách, sau đó máy khách tiến hành truy cập web. (30%)",
    diff: "HARD", lo: "LO2"
  },
  {
    q: "So sánh sự khác biệt giữa giao thức HTTP và HTTPS. Tầm quan trọng của SSL/TLS trong truyền tải dữ liệu web.",
    ans: "HTTP (Hypertext Transfer Protocol) là giao thức cơ bản để gửi các tập tin trên web qua cổng dịch vụ mặc định là 80. Khi gửi và nhận dữ liệu qua HTTP, thông tin hoàn toàn là dạng văn bản thuần túy (plaintext) nên có thể dễ dàng bị can thiệp và đánh cắp. (25%)\n\nHTTPS (HTTP Secure) ra đời bổ sung cơ chế mã hóa mật phủ bằng bảo mật bổ sung qua cổng dịch vụ số 443. Mọi dữ liệu truyền qua HTTPS đều được mã hóa nên người thứ ba không thể phân tích và bắt thông điệp trong thời gian thực. (25%)\n\nSự an toàn của HTTPS có được là nhờ chứng chỉ SSL/TLS, hoạt động kết hợp hai mô hình mã hóa đối xứng (Symmetric) để tăng tốc trao đổi và mã hóa bất đối xứng (Asymmetric) dùng cặp khóa Public/Private rà soát bảo vệ mã sinh ngẫu nhiên. (30%)\n\nTầm quan trọng của giao thức mã hóa này là chống lại các kỹ thuật đánh cắp theo dõi (sniffing/eavesdropping) cũng như các cuộc tấn công Man-in-the-Middle can thiệp và làm hỏng nội dung đường truyền gửi giữa máy người dùng và máy chủ đích. (20%)",
    diff: "EASY", lo: "LO2"
  },
  {
    q: "Mô tả nguyên lý hoạt động gửi và nhận Email, liệt kê các giao thức tham gia (SMTP, POP3, IMAP) và sự khác biệt giữa chúng.",
    ans: "Quá trình gửi Email được phụ trách chính bằng giao thức SMTP (Simple Mail Transfer Protocol). Khi bạn nhấn Send, phần mềm người dùng sẽ đẩy mail tới Mail Server của mình qua kết nối SMTP. Máy chủ đó tiếp tục dùng SMTP để định tuyến và chuyển tiếp mail tới Mail Server của người nhận. (30%)\n\nĐể nhận và tải Email về, giao thức POP3 có cơ chế tự động tải hộp thư từ server về máy người dùng và ngay lập tức xóa bản gốc trên server. Giao thức này giảm dung lượng lưu trữ trên đám mây nhưng khó quản lý trên diện rộng. (25%)\n\nNgược lại, giao thức IMAP sẽ hỗ trợ duy trì đồng bộ hóa hai chiều. Bạn có thể đọc mail trên nhiều thiết bị ở mọi nơi, những gì bạn thực hiện ở client sẽ được phản chiếu lưu lại trên Server mà không bị ẩn đi. (25%)\n\nƯu điểm của IMAP vượt trội hơn hẳn với thời đại có nhiều thiết bị di động, trong khi POP3 chỉ thực sự có lợi nếu bảo mật nội bộ cần cắt đứt hoàn toàn việc giữ dữ liệu nhạy cảm trên máy chủ lưu trú email. (20%)",
    diff: "MEDIUM", lo: "LO2"
  },
  {
    q: "Hãy trình bày hiểu biết về địa chỉ Socket tĩnh và động. Cho ví dụ cụ thể.",
    ans: "Địa chỉ Socket là sự kết hợp đồng thời của một địa chỉ IP và một số cổng (Port), được dùng làm định danh và cổng giao tiếp cho một tiến trình ứng dụng phần mềm hoạt động trên máy tính. (25%)\n\nKhái niệm Socket tĩnh thường gắn với các Well-known ports (từ 0 đến 1023), thường xuyên được giữ nguyên trên các máy chủ cung cấp dịch vụ Internet để phía ứng dụng khách (Client) dễ dàng nhận biết, ví dụ cổng 80 cho HTTP web hay 443 cho HTTPS. (25%)\n\nKhái niệm Socket động (hay ephemeral ports) chỉ khoảng cổng tạm thời mà hệ điều hành bốc ngẫu nhiên từ kho dải cổng cao, cấp nhanh chóng cho mỗi thiết bị duyệt web. Sau khi tắt tab kết nối, số cổng này lại trả về hệ điều hành dùng tiếp. (25%)\n\nVí dụ: Khi bạn mở web, máy bạn mở Socket động (vd: 192.168.1.5:54321) gửi tín hiệu xin tài liệu web đến một máy chủ đang cung cấp ứng dụng chứa địa chỉ Socket tĩnh (vd: 142.250.2.1:80). (25%)",
    diff: "MEDIUM", lo: "LO2"
  },
  
  // LO3
  {
    q: "Trình bày quá trình Bắt tay 3 bước (Three-way handshake) của TCP để thiết lập kết nối.",
    ans: "Quá trình bắt tay 3 bước (Three-way handshake) giúp giao thức TCP kiến tạo nên độ tin cậy và đồng bộ số thứ tự sequence cho hai bên trước khi thực sự truyền lượng lớn gói dữ liệu nhằm tránh bất đồng bộ tình trạng kết nối. (20%)\n\nBước 1: Client sẽ gửi đợt khởi động bằng một gói tin mang cờ hiệu SYN (Synchronize) với một số tuần tự ngẫu nhiên ban đầu (sequence number) để đề xuất mở một kênh truyền tin cậy tới Server đích. (25%)\n\nBước 2: Server nếu đang hoạt động sẵn sàng, sẽ tiếp nhận và gửi lại gói thiết lập mang đồng thời hai cờ SYN và ACK. Gói tín hiệu này vừa báo ghi nhận thành công từ client (ACKnowledgement), vừa tự gửi số tuần tự riêng của Server. (30%)\n\nBước 3: Client lập tức hồi báo về cho Server duy nhất cờ ACK. Ngay sau tín hiệu này, xác thực và bộ đệm bắt đầu được chạy, hai bên bắt đầu chính thức trao đổi luồng dữ liệu TCP mà không lo kết nối trễ. (25%)",
    diff: "MEDIUM", lo: "LO3"
  },
  {
    q: "So sánh chi tiết giao thức TCP và UDP. Khi nào ứng dụng nên chọn UDP thay vì TCP?",
    ans: "Giao thức TCP (Transmission Control Protocol) là giao thức truyền hướng kết nối, đảm bảo dữ liệu tới đích an toàn theo đúng thứ tự. UDP (User Datagram Protocol) nhắm việc truyền vô hướng kết nối (connectionless), dữ liệu gởi đi ngay mà không cần xác nhận, do đó không đảm bảo tin cậy. (30%)\n\nTCP có các tính năng phức tạp như thiết lập bắt tay 3 bước, kiểm soát tắc nghẽn tự động, giảm tải kiểm soát luồng cũng như hệ thống báo lỗi truyền lại gói thất lạc. UDP không có cơ chế truyền lại thông tin hay giảm tải khi nghẽn mạng để giữ sự gọn nhẹ tuyệt đối. (20%)\n\nVì tích hợp ít cấu trúc kiểm soát nên header dán vào thông điệp của UDP rất nhỏ và có tốc độ xử lý nhanh gọn hơn, độ trễ phân tải thấp hơn hẳn so với chi phí mổ xẻ gói tin đồ sộ của giao thức TCP. (20%)\n\nUDP lý tưởng cho các giải pháp thời gian thực, nơi mà trễ vài giây vì đợi truyền định dạng chính xác mới là vấn đề sinh chết. Các trường hợp gồm họp trực tuyến VoIP, livestreaming, hoặc trò chơi mang tính đồng bộ thời gian khắt khe. (30%)",
    diff: "HARD", lo: "LO3"
  },
  {
    q: "Phân biệt IPv4 và IPv6. Tại sao quá trình chuyển đổi sang IPv6 chậm chạp dù IPv4 đã cạn kiệt?",
    ans: "Khác biệt rõ nhất giữa IPv4 và IPv6 nằm ở cấu trúc biểu diễn: IPv4 dài 32 bit, thể hiện dưới dạng hệ thập phân có dấu chấm (vd: 192.168.1.1); trong khi đó IPv6 dài tận 128 bit, được chia thành khối Hex dùng dấu hai chấm phân mảng mở rộng không gian địa chỉ khổng lồ. (25%)\n\nNgoài cung cấp dải IP không giới hạn, IPv6 còn loại bỏ phương pháp gửi Broadcast gây tốn băng thông, tích hợp sẵn tầng bảo mật IPsec mặc định và giảm thiểu tính ứng dụng định tuyến NAT vốn hay phá vỡ cấu trúc mạng đầu - cuối. (25%)\n\nSự chậm trễ vì lý do thứ nhất: Công nghệ dịch IPv4 nội bộ thông qua NAT do Router tự làm đã tạm thời giải quyết xuất sắc kho địa chỉ thực tế thiếu hụt, giúp công ty và tổ chức dùng hàng ngàn máy trọ tráo chỉ dưới 1 địa chỉ public nên mọi người không nôn nóng. (25%)\n\nNguyên nhân chậm trễ tiếp theo: Hai giao thức này không có tính tương thích thuận ngược tự động liên thông với nhau, nâng cấp hoàn toàn một hệ thống thiết bị và ứng dụng đòi hỏi quy mô hạ tầng lớn và chi tiêu khủng khiếp đối với doanh nghiệp. (25%)",
    diff: "MEDIUM", lo: "LO3"
  },
  {
    q: "Trình bày khái niệm Network Address Translation (NAT). Lợi ích và hạn chế của NAT là gì?",
    ans: "NAT (Network Address Translation) giải pháp kỹ thuật hoạt động tại nút chuyển mạch trên router biên, làm nhiệm vụ biến đổi các địa chỉ IP Private trong môi trường mạng nội bộ thành địa chỉ IP Public trước khi đi ra kết nối với thế giới Internet và biến IP Public quay về IP định dạng gốc. (30%)\n\nVới các mô hình tiên tiến hiện đại áp dụng Port Address Translation (PAT/NAT Overload), router gán các quy chuẩn bảng cấp phát Port cụ thể thay vì chỉ dịch ngang bằng IP, cho phép hàng nghìn thiết bị nội bộ chỉ chung 1 cổng IP Public. (25%)\n\nSử dụng NAT có lợi ích khổng lồ: Tiết kiệm đáng kể nguồn cung cạn kiệt của IP Public v4; đồng thời nó được coi như hệ thống che giấu và ngăn truy cập trái phép cấu trúc thực tế từ người dùng bên ngoài Internet. (25%)\n\nHạn chế lớn nhất: Quá trình thiết bị phải tháo gỡ Header để đổi mới IP liên chục gây tải trọng nặng cho CPU của bộ định tuyến. Nó cũng triệt bỏ tính năng định danh IP từ đầu-đến-đích gốc, làm hỏng các đường chuyền như IPsec hay thoại VoIP nội tuyến. (20%)",
    diff: "MEDIUM", lo: "LO3"
  },
  {
    q: "So sánh hai thuật toán định tuyến cơ bản: Distance Vector (Distance Vector) và Trạng thái liên kết (Link-State).",
    ans: "Trong thuật toán định tuyến theo cơ chế Distance Vector, mỗi router chia sẻ định kỳ toàn tuyến thông tin của bản thân cho tất cả các thiết bị bên cạnh, giống hệt cơ chế tin đồn. Router có cái nhìn rất thụ động như người khiếm thị nghe qua người chỉ đường. (30%)\n\nTrái lại, thuật toán Link-State yêu cầu các Router liên tục loan báo và lan truyền trạng thái liên kết (tốc độ link hỏng, tắc) riêng biệt ra khắp hạ tầng mạng. Từ đó, mỗi Node chủ động xây dựng bản đồ hoàn chỉnh và gọi thuật toán Shortest Path Tree để vạch đường đi ngắn nhất. (30%)\n\nDistance Vector chi tiêu vi xử lý trên Router ít và cấu trúc hệ thống thiết kế giản đơn, nhưng tốn phí chiếm dụng rất nhiều gói dữ liệu làm ngập lụt băng thông vô ích trong thời gian bảo trì báo hiệu lẫn lộn. (20%)\n\nVề thời gian, thuật toán Link-State hội tụ trạng thái mạng nhanh chóng chớp nhoáng hơn nhiều và hiếm khi mắc hội chứng định tuyến vòng lẩn quẩn (Routing Loop) vốn là yếu điểm chết người nổi bật ở hệ thống hoạt động Distance Vector cổ điển. (20%)",
    diff: "HARD", lo: "LO3"
  },
  
  // LO4
  {
    q: "Phân tích sự khác biệt cơ bản giữa Hub, Switch và Router. Chúng hoạt động ở tầng nào?",
    ans: "Hub đóng vai trò như một bộ tập trung, nó hoạt động ở Tầng Physical cực kỳ thô sơ. Khi nhận được một gói tín hiệu điện ở đầu vào, Hub không quan tâm ai là chủ và sẽ khuyếch đại lại mọi tín hiệu bằng cách ra phát đều tới toàn bộ các nhánh ngoại trừ nhánh lúc vào. (30%)\n\nSwitch giải quyết vấn đề hiệu năng, hoạt động ở Tầng Data Link bằng việc sử dụng cấu trúc thông minh hơn. Nó xây dựng và thuộc lòng cơ sở dữ liệu Địa chỉ MAC của từng cổng máy. Từ đó, dữ liệu đến cổng mạng luôn được dẫn lối đích xác ngay lập tức điểm cuối nhận cần gửi tới (unicast) mà hạn chế đụng độ. (40%)\n\nRouter là thiết bị tinh vi nhất nằm trên Tầng Network. Nó có khả năng độc lập liên thông kết hợp giữa 2 hay nhiều mạng truyền dẫn con sử dụng các lớp mạng IP khác biệt, đồng thời đưa ra quyết định xác định đường vạch chuyển nhanh nhất ở quy mô diện rộng không thể làm tới bằng Switch nội trú. (30%)",
    diff: "EASY", lo: "LO4"
  },
  {
    q: "Trình bày cách thức một thiết bị Switch học địa chỉ MAC để chuyển tiếp khung (Frame) trong mạng nội bộ.",
    ans: "Khi bộ chuyển mạch Switch vừa mới khởi động hoặc đưa vào trạng thái sẵn sàng, bảng địa chỉ MAC tĩnh và động (CAM Table) vẫn còn đang duy trì ở trạng thái trống rỗng hoang tàn, do chưa rõ thiết bị gắn qua máy nhánh kết nối tương ứng nào. (20%)\n\nQuá trình \"học\": Ngay từ khi máy kết nối trạm đầu tiên gửi qua một khung bản tin (Frame), Switch ngay lập tức bóc tách vùng dữ liệu Source MAC (Đầu gửi) để học ghi chép liên kết vào danh bạ ứng với cái cổng tương tự nó vừa di chuyển tới. (30%)\n\nCơ chế ngập lụt (Flooding): Khi trong bảng cấu hình không hề có Địa chỉ đích cho dòng Destination MAC, hoặc khung vừa vào là địa chỉ broadcast, bộ Switch do không định đoạt được thông tin, đành bắt buộc tung chuyển bản tin tràn lụt ra tất cả các cửa ngõ trừ hướng nhận báo. (30%)\n\nCơ chế truyền xuôi (Forwarding): Một khi mà hai bên đều đã lưu danh đầy đủ vào mục tiêu cổng nhận đích trên bảng CAM, Switch thực thi trực diện mở mạch truyền luồng song phương lập tức. Switch cũng liên thông giữ chừng mực tuổi thọ bản ghi để liên tục xóa xóa dọn sạch ngắt mạng ảo. (20%)",
    diff: "HARD", lo: "LO4"
  },
  {
    q: "Giải thích cơ chế phân giải địa chỉ ARP (Address Resolution Protocol) khi một máy tính A muốn gửi gói tin cho máy tính B trong cùng mạng.",
    ans: "Giao thức ARP là sự thiết yếu cho bất cứ kết nối mạng nội bộ nào, do tầng mạng IP chỉ cung cấp nhãn ảo nhưng ở khu vực Tầng liên kết dữ liệu bắt buộc máy chuyển định dạng phải đòi địa chỉ vật lý MAC để tạo Frame chính thức đẩy qua đường dây. (25%)\n\nĐể bắt đầu, máy tính khách A sẽ ưu tiên dùng thủ thuật kiểm duyệt lịch sử kết nối hiện thời trong ARP Cache của chính mình, để rọi quét tìm liệu MAC của máy khách B có đang nằm lưu trú tĩnh động ở trong đó hay không để sử dụng tức. (20%)\n\nNếu ARP Cache trống không có lịch sử, thiết bị A khởi tạo một tín hiệu hỏi đường ARP Request đại loại là \"Ai đang giữ địa chỉ IP X.X của B này, trình diện đi\" – tín hiệu truyền phát sóng bằng cơ chế Broadcast đập tất cả thiết bị trên mạng. (25%)\n\nMáy B nghe tín hiệu và xác minh chính IP tên mình trong Request. Máy B cất Source MAC của A vào bảng theo dõi, sau đó gửi một gói ARP Reply truyền duy nhất (unicast) chạy song quy mang con dấu Địa chỉ vật lý của đích thân B vào máy trạm A, chu trình gán khép lại hoàn tất. (30%)",
    diff: "MEDIUM", lo: "LO4"
  },
  {
    q: "Mô tả cơ chế đa truy cập cảm mạng tránh xung đột CSMA/CD trong hệ thống cáp mạng Ethernet.",
    ans: "Cơ chế đa truy cập CSMA (Carrier Sense Multiple Access - Cảm nhận sóng mang) hoạt động qua việc yêu cầu bất kỳ thực thể truyền dẫn nào trên mạng cũng đều phải nằm vùng để xác nhận thiết bị thu thanh tín hiệu. Nếu nhận thấy chưa ai dùng (đường rỗi), mới tính đến động lực xả thông điệp chạy đi. (25%)\n\nNếu đường tín hiệu bận có trạm khác đè sóng, máy chủ sẽ đợi liên hợp sau phiên xử lý kết thúc của bên đối tác. Tuy cẩn thận vậy nhưng vì thời gian tín hiệu lan truyền vật lý độ trễ chênh lệch, hai nhóm vẫn rất có rủi ro đồng loạt dội điện và gặp đè xung đột. (25%)\n\nPhần nhận diện CD (Collision Detection), hoạt động như chốt chặn cảnh báo: Thiết bị tiến hành phát một mảnh frame cũng đồng thời căng tai áp sát so le tín hiệu phản dội trên cáp với chính bản gốc xuất. Nếu tín hiệu lạ chéo, máy thu nhận đang có điện áp sốc đè biến dạng biểu thị xung đột. (25%)\n\nKhi xung đột bị tóm điểm, lệnh báo nhiễu (Jam Signal) sẽ ném ốp toàn tuyến hãm việc phát tín hiệu đang cháy, các máy liên đới tự ngắt và dùng chung thuật toán tạm ngừng ngẫu nhiên ngả mũ lùi lịch (Backoff) chờ để xung kích sau tránh lặp lại bế tắc. (25%)",
    diff: "HARD", lo: "LO4"
  },
  {
    q: "Địa chỉ MAC được cấu trúc như thế nào và có liên quan gì đến OUI?",
    ans: "Địa chỉ MAC (Media Access Control) là địa chỉ vật lý mang định tính phần cứng, quản lý tại thiết bị thu phát trung tâm cấu tạo có chiều dài là 48 bits (Chia nhỏ 6 Bytes), được nhà viễn thông in định dạng phân chia qua mã hệ thập lục phân Hexadecimal rõ phân biệt. (25%)\n\nĐặc tính vĩnh viễn gắn liền: Địa chỉ này thường ghi khảm chết cố định (Burned-in) do xưởng ngay từ khâu sản xuất thiết bị Card Mạng (NIC). Khác hoàn toàn cách quản lý chia sẻ từ IP, nhãn danh này có tính duy nhất vĩnh viễn độc quyền không bao giờ sao y toàn cầu. (25%)\n\nNửa định danh đầu tiên gồm 24 bit quan trọng định tuyến xuất phát hãng gọi là OUI (Organizationally Unique Identifier). Tập đoàn Tiêu chuẩn bảo hộ IEEE gán riêng cho từng thương hiệu doanh nghiệp độc quyền để rọi nhận dạng nhãn nhà chế tác sản xuất linh kiện đó. (25%)\n\nPhân nửa 24 bit tồn động sau cùng của tổng thể mới thuộc toàn vẹn chi phối thao tác đánh số nháp do phía nhà xuất xưởng doanh nghiệp gán đánh liên tiếp tùy biến trong lô hàng nhằm giúp quản lý phân luồng thiết bị NIC để vạn thành tuyệt đối không đụng hàng gốc. (25%)",
    diff: "EASY", lo: "LO4"
  }
];

async function main() {
  console.log('🌱 Bắt đầu tạo mới ngân hàng câu hỏi môn: Kiến thức chung về mạng máy tính...');

  let teacher = await prisma.user.findFirst({ where: { role: 'TEACHER' } });
  if (!teacher) {
    teacher = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  }
  if (!teacher) {
    throw new Error("Không tìm thấy user với role TEACHER hoặc ADMIN.");
  }

  const subject = await prisma.subject.create({
    data: {
      name: "Kiến thức chung về mạng máy tính",
      teacherId: teacher.id,
    }
  });

  console.log(`✅ Đã tạo môn học: ${subject.name} (ID: ${subject.id})`);

  const los = [
    { code: "LO1", description: "Hiểu các khái niệm mạng cơ bản và mô hình tham chiếu (OSI, TCP/IP)" },
    { code: "LO2", description: "Hiểu các định dạng giao thức và tầng ứng dụng" },
    { code: "LO3", description: "Hiểu các khái niệm truyền tải và định tuyến mạng (IP, TCP/UDP)" },
    { code: "LO4", description: "Hiểu tầng liên kết dữ liệu và kiến trúc vật lý (MAC, Ethernet, Switching)" }
  ];

  const loMap: Record<string, number> = {};
  for (const loData of los) {
    const lo = await prisma.learningOutcome.create({
      data: {
        subjectId: subject.id,
        code: loData.code,
        description: loData.description
      }
    });
    loMap[lo.code] = lo.id;
  }
  console.log(`✅ Đã tạo ${los.length} chuẩn đầu ra (Learning Outcomes).`);

  let mcqCount = 0;
  for (const q of mcqQuestions) {
    await prisma.question.create({
      data: {
        subjectId: subject.id,
        type: "MULTIPLE_CHOICE",
        content: q.q,
        answer: q.ans,
        options: JSON.stringify(q.options),
        difficulty: q.diff,
        learningOutcomeId: loMap[q.lo]
      }
    });
    mcqCount++;
  }
  console.log(`✅ Đã tạo ${mcqCount} câu hỏi trắc nghiệm.`);

  let essayCount = 0;
  for (const q of essayQuestions) {
    await prisma.question.create({
      data: {
        subjectId: subject.id,
        type: "ESSAY",
        content: q.q,
        answer: q.ans,
        difficulty: q.diff,
        learningOutcomeId: loMap[q.lo]
      }
    });
    essayCount++;
  }
  console.log(`✅ Đã tạo ${essayCount} câu hỏi tự luận chi tiết có phần trăm điểm.`);
  console.log('🎉 Hoàn tất Seed cho môn học mới!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
